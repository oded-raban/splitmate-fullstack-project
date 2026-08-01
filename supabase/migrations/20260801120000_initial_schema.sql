-- =============================================================================
-- SplitMate — 01. Initial schema
-- =============================================================================
-- Creates every table, enum, constraint and index in the system.
-- Triggers live in 02, RLS policies in 03, business RPCs in 04, storage in 05.
--
-- DESIGN NOTES THAT APPLY TO THE WHOLE FILE
-- -----------------------------------------------------------------------------
-- Money: every monetary column is `bigint` holding MINOR UNITS (agorot for ILS,
--   cents for USD). Never numeric, never float. Binary floating point cannot
--   represent 0.1 exactly, and the error compounds once you divide a bill three
--   ways; integers make every operation exact and every test deterministic.
--   ₪125.50 is stored as 12550.
--
-- Time: every timestamp is `timestamptz`. A naive `timestamp` silently drops the
--   offset, so the same row means different instants depending on who reads it.
--   `spent_at` is a plain `date` on purpose — "which day did we buy milk" is a
--   calendar fact, not an instant, and forcing it into a timestamp invents a
--   timezone question that has no correct answer.
--
-- Deletion: financial rows are SOFT deleted (`deleted_at` / `voided_at`). The
--   audit trail is a product feature — a roommate must be able to see that an
--   expense existed and who removed it. Every read path filters these out.
--
-- Ordering: tables are declared in dependency order so each foreign key
--   references a table that already exists.
-- =============================================================================

-- `gen_random_uuid()` lives in pgcrypto on older servers; on Supabase it is
-- available by default, but requesting it explicitly makes this migration
-- portable to a plain Postgres instance.
create extension if not exists pgcrypto with schema extensions;


-- =============================================================================
-- ENUMS
-- =============================================================================
-- Enums are used rather than text + CHECK because they are self-documenting,
-- comparably cheap, and generate a proper TypeScript union in the generated
-- database types — so an invalid split method becomes a compile error.

-- Household permissions. See docs/01-product-requirements.md §8.1 for the matrix.
create type public.household_role as enum ('owner', 'admin', 'member');

-- How an expense's total is divided among its participants.
--   equal      — split evenly, indivisible remainder distributed deterministically
--   exact      — each participant's share entered directly, must sum to the total
--   percentage — shares entered as percentages, must sum to 100
--   shares     — integer weights, e.g. 2:1:1 for a larger room
create type public.split_method as enum ('equal', 'exact', 'percentage', 'shares');

-- How a real-world settlement payment was made. Purely a label: SplitMate
-- records that money moved, it never moves money itself.
create type public.settlement_method as enum (
  'bit', 'bank_transfer', 'cash', 'paypal', 'other'
);

-- Cadence of an automated recurring expense (rent, internet, ...).
create type public.recurrence_freq as enum ('weekly', 'monthly', 'yearly');

-- Notification kinds. Kept as an enum so the UI can exhaustively switch on it.
create type public.notification_type as enum (
  'invite_accepted',
  'member_joined',
  'member_removed',
  'expense_created',
  'expense_updated',
  'expense_deleted',
  'settlement_recorded',
  'settlement_voided',
  'recurring_generated'
);


-- =============================================================================
-- PROFILES — application-level identity
-- =============================================================================
-- Supabase owns `auth.users`, which we cannot extend and should not query from
-- application code. `profiles` is our mirror: it holds the fields the product
-- needs (a display name roommates recognise, an avatar) and is safe to join
-- against from every other table.
--
-- Rows are created automatically by a trigger on auth.users (migration 02), so
-- a profile is guaranteed to exist before the user's first request. Creating it
-- lazily in application code invites a race where two concurrent requests both
-- try to insert it.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,

  -- What other members see. Trimmed length check rejects "   " as a name.
  display_name text not null
    check (char_length(trim(display_name)) between 1 and 60),

  -- Denormalised from auth.users so invitations can be matched by address
  -- without granting the application read access to the auth schema.
  email        text not null,

  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Application-facing user identity, mirrored from auth.users by trigger.';


-- =============================================================================
-- HOUSEHOLDS — the tenancy boundary
-- =============================================================================
-- Every other row in the system belongs to exactly one household, and every RLS
-- policy ultimately resolves to "is the caller a member of this household".
create table public.households (
  id         uuid primary key default gen_random_uuid(),

  name       text not null
    check (char_length(trim(name)) between 1 and 80),

  -- One currency per household, fixed at creation. Multi-currency with FX is an
  -- explicit non-goal (see PRD §8.3): converting a debt raises the unanswerable
  -- question of *which day's* exchange rate the debt is owed at.
  currency   char(3) not null default 'ILS'
    check (currency ~ '^[A-Z]{3}$'),

  -- Recurring rules fire "on the 1st" in the household's local time, not the
  -- server's. Without this, a rule fires on the 31st for someone in Los Angeles.
  timezone   text not null default 'Asia/Jerusalem',

  -- Monetisation boundary. Billing is not implemented (PRD §4.3), but quota
  -- checks read this column, so the free/pro distinction is real in the data.
  plan       text not null default 'free'
    check (plan in ('free', 'pro')),

  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Archiving hides a household without destroying its financial history.
  archived_at timestamptz
);

comment on table public.households is
  'A shared workspace. The tenancy boundary for all data isolation.';


-- =============================================================================
-- HOUSEHOLD MEMBERS — who belongs where, and with what rights
-- =============================================================================
create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references public.profiles (id)   on delete cascade,
  role         public.household_role not null default 'member',
  joined_at    timestamptz not null default now(),

  -- Composite primary key: a user is in a household at most once, enforced by
  -- the database rather than by "check before insert" application code, which
  -- is racy under concurrent invitation acceptance.
  primary key (household_id, user_id)
);

-- "Which households am I in?" runs on every page load for the household
-- switcher. The primary key indexes (household_id, user_id) and therefore
-- cannot serve a lookup by user_id alone, so this index is required.
create index idx_members_by_user
  on public.household_members (user_id);

-- Exactly one owner per household. A partial unique index expresses this
-- precisely: it constrains only the rows where role = 'owner', so it permits
-- many members and many admins while making a second owner impossible.
create unique index idx_household_single_owner
  on public.household_members (household_id)
  where role = 'owner';

comment on table public.household_members is
  'Membership and role. The table every RLS policy ultimately consults.';


-- =============================================================================
-- INVITATIONS — the growth loop
-- =============================================================================
-- Two flavours share one table:
--   • email invite  — `email` is set; only that address may accept
--   • link invite   — `email` is null; anyone holding the link may accept
create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  email        text,

  -- SECURITY: we store only the SHA-256 hash of the invitation token, never the
  -- token itself — exactly as one would store a password. The raw token exists
  -- only in the emailed URL. If this table leaked, the hashes would not let an
  -- attacker join anything, because acceptance requires presenting the preimage.
  token_hash   text not null unique,

  -- Ownership is transferred explicitly, never handed out by invitation.
  role         public.household_role not null default 'member'
    check (role <> 'owner'),

  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),

  -- Invitations expire so that a link leaked into a group chat a year ago
  -- cannot be used today.
  expires_at   timestamptz not null,

  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles (id),
  revoked_at   timestamptz,

  -- An invitation cannot be both accepted and revoked, and if it was accepted
  -- we must know by whom.
  check (accepted_at is null or accepted_by is not null),
  check (accepted_at is null or revoked_at is null)
);

-- Listing outstanding invitations on the members page. Partial: accepted rows
-- are history and are never listed as pending, so they are kept out of the index.
create index idx_invitations_pending
  on public.invitations (household_id, created_at desc)
  where accepted_at is null and revoked_at is null;

comment on column public.invitations.token_hash is
  'SHA-256 of the invite token. The raw token is never persisted.';


-- =============================================================================
-- CATEGORIES
-- =============================================================================
-- `household_id IS NULL` marks a system category available to everyone. Each
-- new household gets its own copies (created by the household RPC) so members
-- can rename or recolour them without affecting anyone else.
create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid references public.households (id) on delete cascade,

  name         text not null
    check (char_length(trim(name)) between 1 and 40),

  -- Lucide icon name and a hex colour, resolved in the UI.
  icon         text not null default 'receipt',
  color        text not null default '#64748b'
    check (color ~ '^#[0-9a-fA-F]{6}$'),

  sort_order   int not null default 100,
  created_at   timestamptz not null default now(),

  -- Two categories called "Groceries" in one household would make the picker
  -- ambiguous and the analytics breakdown wrong.
  unique (household_id, name)
);


-- =============================================================================
-- RECURRING EXPENSES — declared before `expenses`, which references it
-- =============================================================================
create table public.recurring_expenses (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,

  -- Template of the expense to generate.
  description   text not null
    check (char_length(trim(description)) between 1 and 120),
  amount_minor  bigint not null check (amount_minor > 0),
  category_id   uuid references public.categories (id) on delete set null,
  payer_id      uuid not null references public.profiles (id),
  split_method  public.split_method not null,

  -- Participants and their raw inputs (percentages / weights), e.g.
  --   [{"user_id": "...", "input": 50}, {"user_id": "...", "input": 50}]
  -- jsonb rather than a child table: this is an inert template that is only
  -- ever read as a whole by the generator, never queried across rows.
  split_config  jsonb not null,

  frequency     public.recurrence_freq not null,

  -- Day-of-month (or day-of-week for weekly rules). Values above the length of
  -- a given month are clamped by the generator, so "the 31st" fires on 28 Feb.
  day_of_period int not null check (day_of_period between 1 and 31),

  -- Driven by the daily scheduled job. Indexed below.
  next_run_at   date not null,
  last_run_at   date,
  is_active     boolean not null default true,

  created_by    uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The cron job asks one question daily: "which rules are due?" This partial
-- index answers it by scanning only active rules, so the job stays O(due rules)
-- rather than O(all rules ever created) as the product grows.
create index idx_recurring_due
  on public.recurring_expenses (next_run_at)
  where is_active;


-- =============================================================================
-- EXPENSES — the ledger
-- =============================================================================
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  -- Who actually paid the merchant. Distinct from `created_by`: a roommate may
  -- log an expense on someone else's behalf ("Maya paid, but I entered it").
  payer_id     uuid not null references public.profiles (id),

  category_id  uuid references public.categories (id) on delete set null,

  description  text not null
    check (char_length(trim(description)) between 1 and 120),

  -- Minor units. The upper bound (1,000,000.00 in major units) is a sanity
  -- ceiling: it catches a misplaced decimal point or a paste of an account
  -- number long before that value reaches a balance.
  amount_minor bigint not null
    check (amount_minor > 0 and amount_minor <= 100000000),

  split_method public.split_method not null,
  spent_at     date not null,

  note         text check (char_length(note) <= 500),

  -- Storage object path, e.g. "<household_id>/<expense_id>/<uuid>.webp".
  -- The bucket is private; the app serves short-lived signed URLs.
  receipt_path text,

  -- Set when the row was generated by the scheduled job rather than by a person.
  recurring_id uuid references public.recurring_expenses (id) on delete set null,

  -- Guards double submission: a flaky connection or an impatient double-tap
  -- would otherwise create the same expense twice, which is invisible in the UI
  -- but wrong in the balances. See the partial unique index below.
  idempotency_key text,

  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Soft delete. Removed expenses leave balances but stay in the audit trail.
  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles (id),

  check (deleted_at is null or deleted_by is not null)
);

-- The household ledger, newest first. `id` is included as a tiebreaker because
-- `spent_at` is only a date: without it, several expenses on the same day have
-- no stable order, and cursor pagination would skip or repeat rows.
-- Partial (`deleted_at is null`) so the index stays small and every feed query
-- can be answered from it alone.
create index idx_expenses_feed
  on public.expenses (household_id, spent_at desc, id desc)
  where deleted_at is null;

-- "How much have I paid out?" — the paid side of every balance calculation.
create index idx_expenses_payer
  on public.expenses (payer_id)
  where deleted_at is null;

-- Analytics groups by category within a date range.
create index idx_expenses_category
  on public.expenses (household_id, category_id, spent_at)
  where deleted_at is null;

-- Idempotency: at most one expense per household per key. Partial, so the vast
-- majority of rows (which carry no key) are unaffected.
create unique index idx_expenses_idempotency
  on public.expenses (household_id, idempotency_key)
  where idempotency_key is not null;

comment on table public.expenses is
  'Append-only ledger of shared costs. Amounts are minor units; rows are soft deleted.';


-- =============================================================================
-- EXPENSE SPLITS — one row per participant per expense
-- =============================================================================
-- The invariant that matters: for any expense,
--     SUM(expense_splits.share_minor) = expenses.amount_minor
-- exactly. It is enforced by a deferred constraint trigger in migration 02, so
-- the database structurally cannot hold an unbalanced expense.
create table public.expense_splits (
  expense_id  uuid not null references public.expenses (id) on delete cascade,
  user_id     uuid not null references public.profiles (id),

  -- This participant's obligation, in minor units. Zero is legal: a participant
  -- may be recorded on an expense with a nil share (e.g. a percentage split
  -- that rounds to nothing), and forbidding it would break that case.
  share_minor bigint not null check (share_minor >= 0),

  -- What the user actually typed: 33.33 for a percentage split, 2 for a weight.
  -- Kept so the edit form can reopen showing the original intent rather than
  -- the derived minor-unit amount, which would look arbitrary.
  share_input numeric(12, 4),

  primary key (expense_id, user_id)
);

-- "What do I owe across everything?" — the owed side of every balance
-- calculation, and the reason the cross-household dashboard is fast.
create index idx_splits_by_user
  on public.expense_splits (user_id);


-- =============================================================================
-- EXPENSE REVISIONS — edit history
-- =============================================================================
-- Transparency is the product (PRD §5, principle 3). Any member can see how an
-- expense changed and who changed it. Stored as before/after jsonb snapshots
-- rather than a column-level diff: snapshots survive schema evolution, and the
-- diff can always be computed at render time.
create table public.expense_revisions (
  id         uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  changed_by uuid not null references public.profiles (id),
  changed_at timestamptz not null default now(),
  before     jsonb not null,
  after      jsonb not null
);

create index idx_revisions_by_expense
  on public.expense_revisions (expense_id, changed_at desc);


-- =============================================================================
-- SETTLEMENTS — records that money moved in the real world
-- =============================================================================
create table public.settlements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  from_user    uuid not null references public.profiles (id),
  to_user      uuid not null references public.profiles (id),

  amount_minor bigint not null check (amount_minor > 0),
  method       public.settlement_method not null default 'other',
  note         text check (char_length(note) <= 300),

  -- When the real payment happened, which may predate when it was recorded.
  settled_at   timestamptz not null default now(),

  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),

  -- Disputed or mistaken settlements are voided, never deleted: the fact that
  -- someone claimed a payment and it was disputed is itself worth keeping.
  voided_at    timestamptz,
  voided_by    uuid references public.profiles (id),

  -- Paying yourself would be a no-op that silently corrupts nothing but
  -- confuses every balance display.
  check (from_user <> to_user),
  check (voided_at is null or voided_by is not null)
);

create index idx_settlements_feed
  on public.settlements (household_id, settled_at desc)
  where voided_at is null;

-- Balance derivation sums settlements per party; these support both directions.
create index idx_settlements_from on public.settlements (from_user) where voided_at is null;
create index idx_settlements_to   on public.settlements (to_user)   where voided_at is null;


-- =============================================================================
-- SHOPPING
-- =============================================================================
create table public.shopping_lists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null default 'Shopping'
    check (char_length(trim(name)) between 1 and 60),
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now()
);

create index idx_lists_by_household on public.shopping_lists (household_id);

create table public.shopping_items (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references public.shopping_lists (id) on delete cascade,

  -- DENORMALISED from the parent list on purpose. Realtime subscriptions filter
  -- on a single column of the changed row and cannot join, so without this
  -- column every client would receive every household's item events and filter
  -- them client-side — a data leak, not merely an inefficiency. RLS policies
  -- also become a direct membership check instead of a join.
  household_id uuid not null references public.households (id) on delete cascade,

  name         text not null
    check (char_length(trim(name)) between 1 and 80),

  -- Free text ("2 kg", "a big one") rather than a number: shopping lists are
  -- written by humans in a hurry, and forcing a numeric quantity adds friction
  -- for no analytical benefit.
  quantity     text check (char_length(quantity) <= 20),

  estimated_minor bigint check (estimated_minor >= 0),

  added_by     uuid not null references public.profiles (id),
  checked_by   uuid references public.profiles (id),
  checked_at   timestamptz,

  -- Set when the item is converted into an expense at checkout, which archives
  -- it and links it to the created expense for traceability.
  archived_at          timestamptz,
  converted_expense_id uuid references public.expenses (id) on delete set null,

  -- Manual ordering, so items appear in the sequence they were added rather
  -- than jumping around as rows update.
  position     int not null default 0,
  created_at   timestamptz not null default now(),

  -- Checked state is (who, when) — both present or both absent.
  check ((checked_by is null) = (checked_at is null))
);

-- The active list view: unarchived items in display order.
create index idx_items_active
  on public.shopping_items (list_id, position)
  where archived_at is null;

-- Realtime filters and RLS both resolve by household.
create index idx_items_by_household on public.shopping_items (household_id);


-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  household_id uuid references public.households (id) on delete cascade,
  type         public.notification_type not null,

  -- Denormalised context for rendering ({"amount": 12550, "actor": "Maya"}).
  -- Stored rather than re-derived so that a notification about a deleted
  -- expense still renders something meaningful.
  payload      jsonb not null default '{}'::jsonb,

  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- The unread badge is rendered on every authenticated page, so this query must
-- be trivial. Partial index over unread rows only keeps it that way even after
-- a user accumulates thousands of read notifications.
create index idx_notifications_unread
  on public.notifications (user_id, created_at desc)
  where read_at is null;


-- =============================================================================
-- ACTIVITY LOG — append-only audit trail
-- =============================================================================
-- Serves double duty: the user-facing "recent activity" feed, and the security
-- evidence that every mutation is attributed. RLS grants SELECT only; there is
-- deliberately no UPDATE or DELETE policy, so not even a household owner can
-- rewrite history through the API.
create table public.activity_log (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  -- Nullable: system-generated events (a recurring bill firing) have no actor.
  actor_id     uuid references public.profiles (id) on delete set null,

  entity_type  text not null
    check (entity_type in (
      'expense', 'settlement', 'member', 'invitation',
      'household', 'shopping_item', 'recurring'
    )),
  entity_id    uuid,
  action       text not null
    check (action in (
      'created', 'updated', 'deleted', 'restored', 'voided',
      'joined', 'left', 'removed', 'role_changed', 'accepted'
    )),

  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index idx_activity_feed
  on public.activity_log (household_id, created_at desc);
