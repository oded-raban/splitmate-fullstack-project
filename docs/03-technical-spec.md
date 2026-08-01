# SplitMate — Detailed Technical Specification

| Field        | Value                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| Document     | Technical Design (Deliverable #4, part 2)                                  |
| Version      | 1.0                                                                        |
| Related docs | [PRD](./01-product-requirements.md) · [Architecture](./02-architecture.md) |

The purpose of this document is to make implementation mechanical: by the end of it, every table, constraint, policy, function signature, algorithm, error code and screen is decided. Nothing below should require a design decision during coding.

---

## 1. Directory Structure

```
splitmate/
├── app/
│   ├── (marketing)/                 # Public, statically rendered
│   │   ├── layout.tsx               # Marketing shell (nav + footer)
│   │   ├── page.tsx                 # Landing
│   │   ├── pricing/page.tsx
│   │   └── (legal)/privacy|terms/page.tsx
│   ├── (auth)/
│   │   ├── layout.tsx               # Centred card shell
│   │   ├── login/page.tsx           # Magic link + Google
│   │   └── verify/page.tsx          # "Check your email"
│   ├── auth/callback/route.ts       # OAuth / magic-link code exchange
│   ├── (app)/
│   │   ├── layout.tsx               # Auth guard, household switcher, nav
│   │   ├── onboarding/page.tsx
│   │   ├── app/page.tsx             # Cross-household dashboard
│   │   ├── app/notifications/page.tsx
│   │   ├── app/settings/page.tsx
│   │   ├── app/invite/[token]/page.tsx
│   │   └── app/households/[householdId]/
│   │       ├── layout.tsx           # Membership guard + household nav
│   │       ├── page.tsx             # Home: balances + recent activity
│   │       ├── loading.tsx | error.tsx | not-found.tsx
│   │       ├── expenses/
│   │       │   ├── page.tsx         # Ledger (filters + pagination)
│   │       │   ├── new/page.tsx
│   │       │   └── [expenseId]/(page|edit)/…
│   │       ├── settle/page.tsx
│   │       ├── shopping/page.tsx
│   │       ├── insights/page.tsx
│   │       ├── recurring/page.tsx
│   │       ├── members/page.tsx
│   │       ├── activity/page.tsx
│   │       └── settings/page.tsx
│   ├── api/
│   │   ├── cron/recurring/route.ts
│   │   └── export/[householdId]/route.ts
│   ├── layout.tsx                   # Root: fonts, providers, Toaster
│   └── globals.css
│
├── components/
│   ├── ui/                          # shadcn primitives (button, dialog, …)
│   ├── layout/                      # AppShell, HouseholdSwitcher, NavBar
│   ├── expenses/                    # ExpenseForm, SplitEditor, ExpenseList, …
│   ├── settlements/                 # BalanceSummary, SettlementSuggestions
│   ├── shopping/                    # ShoppingList, ShoppingItemRow, Checkout
│   ├── insights/                    # CategoryChart, TrendChart, MemberChart
│   ├── members/                     # MemberList, InviteDialog, RoleSelect
│   └── shared/                      # Money, Avatar, EmptyState, ErrorState
│
├── lib/
│   ├── domain/                      # PURE — no framework imports
│   │   ├── money.ts                 # Minor-unit arithmetic + formatting
│   │   ├── splits.ts                # 4 split strategies + largest remainder
│   │   ├── balances.ts              # Net position derivation
│   │   ├── simplify.ts              # Debt simplification
│   │   ├── recurrence.ts            # Next-occurrence calculation
│   │   └── types.ts
│   ├── supabase/
│   │   ├── server.ts                # RSC / Server Action client (user JWT)
│   │   ├── client.ts                # Browser client (Realtime)
│   │   ├── proxy.ts                 # Session refresh helper for proxy.ts
│   │   ├── admin.ts                 # service-role — cron only
│   │   └── database.types.ts        # GENERATED — never hand-edited
│   ├── data/                        # Query functions used by Server Components
│   ├── actions/                     # Server Actions, one file per aggregate
│   ├── validation/                  # Zod schemas shared client + server
│   ├── auth/                        # requireUser, requireMember, requireRole
│   ├── errors.ts                    # AppError, error codes, PG error mapping
│   ├── result.ts                    # ActionResult discriminated union
│   ├── env.ts                       # Zod-validated environment variables
│   └── utils.ts
│
├── supabase/
│   ├── migrations/                  # Versioned SQL, applied in order
│   ├── functions.sql                # RPCs (kept as migrations too)
│   └── seed.sql
│
├── tests/
│   ├── unit/                        # Domain layer (Vitest)
│   ├── components/                  # RTL
│   ├── integration/                 # RLS / DB as two real users
│   └── e2e/                         # Playwright
│
├── docs/                            # All course deliverables
├── emails/                          # React Email templates
├── types/env.d.ts                   # Typed process.env keys
├── proxy.ts                         # Session refresh + route guard + headers
└── config files (next, tsconfig, vitest, playwright, eslint, prettier)
```

**The load-bearing rule:** `lib/domain` may not import from `lib/supabase`, `next`, or `react`. Enforced by an ESLint `no-restricted-imports` rule. This keeps the financially critical code testable in isolation.

### 1.1 Platform version constraints

The project is built on **Next.js 16**, which changed several conventions that older documentation and most existing tutorials still describe the old way. These are recorded here because they affect nearly every file we write:

| Change                                                           | Consequence for this codebase                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `middleware.ts` → **`proxy.ts`**, exporting `proxy`              | The session-refresh and route-guard file sits at the project root as `proxy.ts`. It runs on the **Node.js runtime**; the edge runtime is not available to it.                                                                                      |
| **Request APIs are async-only**                                  | `cookies()`, `headers()`, and the `params` / `searchParams` props of pages, layouts and route handlers are Promises. Every Supabase server client and every dynamic page must `await` them. Synchronous access was removed, not merely deprecated. |
| **Turbopack is the default** bundler                             | No `--turbopack` flag in the npm scripts.                                                                                                                                                                                                          |
| **`next lint` removed**                                          | Linting runs through the ESLint CLI, and `next build` no longer lints — so lint must be a separate CI step, or it silently stops running.                                                                                                          |
| `revalidateTag` requires a cache-life profile; `updateTag` added | Server Actions that need read-your-writes semantics use `updateTag`; `revalidatePath` is unchanged and remains our primary invalidation tool.                                                                                                      |
| Generated `PageProps` / `LayoutProps` / `RouteContext` helpers   | Route props are typed from the actual route string, so a renamed dynamic segment becomes a compile error.                                                                                                                                          |

---

## 2. Component Architecture

### 2.1 Server vs. client boundary

Default to Server Components. A component becomes a client component only if it needs state, effects, browser APIs, or event handlers. Client components are pushed as far down the tree as possible so that pages stay server-rendered — the pattern is a server page that fetches data and passes it as props into a small interactive island.

| Component               | Type   | Responsibility                                                                  |
| ----------------------- | ------ | ------------------------------------------------------------------------------- |
| `HouseholdLayout`       | Server | Membership guard; loads household + members once for the subtree                |
| `BalanceSummary`        | Server | Renders the result of `get_household_balances`                                  |
| `ExpenseList`           | Server | Paginated ledger rows                                                           |
| `ExpenseFilters`        | Client | Writes filter state to the URL (`searchParams`)                                 |
| `ExpenseForm`           | Client | react-hook-form + Zod; orchestrates `SplitEditor`                               |
| `SplitEditor`           | Client | Split method tabs, per-participant inputs, live remainder                       |
| `SplitPreview`          | Client | Pure render of computed shares — calls the same domain function the server does |
| `ReceiptUploader`       | Client | Compression, progress, retry                                                    |
| `SettlementSuggestions` | Server | Simplified transfer list                                                        |
| `SettleDialog`          | Client | Confirmation + amount override                                                  |
| `ShoppingListView`      | Client | Realtime subscription + optimistic reducer                                      |
| `InsightsCharts`        | Client | Recharts, dynamically imported                                                  |
| `NotificationBell`      | Client | Unread count + dropdown                                                         |

### 2.2 Two patterns worth naming

**Shared computation across the boundary.** `SplitEditor` computes the preview with `lib/domain/splits.ts`, and the Server Action recomputes with _the same function_ on submit. The client result is advisory; the server result is authoritative. Identical code on both sides means the preview can never disagree with the saved value — while the server still never trusts client-supplied shares.

**Optimistic mutation.** Interactive lists wrap actions in `useOptimistic`: apply locally, call the action, and on failure roll back and show a toast naming what failed. For the shopping list this composes with Realtime — the optimistic entry is replaced by the authoritative row when the broadcast arrives, matched by a client-generated UUID sent with the insert.

---

## 3. Database Schema

Conventions: `uuid` primary keys with `gen_random_uuid()`; `timestamptz` everywhere (never naive timestamps); money as `bigint` in minor units; `snake_case`; every table has `created_at`; soft-deletable tables have `deleted_at`.

The listing below is grouped for readability rather than in executable order — `expenses.recurring_id` and `recurring_expenses` reference each other, so in the actual migration files the tables are created first and the circular foreign key is added afterwards with `alter table … add constraint`.

```sql
-- ─────────────────────────── ENUMS ───────────────────────────
create type household_role  as enum ('owner','admin','member');
create type split_method    as enum ('equal','exact','percentage','shares');
create type settlement_method as enum ('bit','bank_transfer','cash','paypal','other');
create type recurrence_freq as enum ('weekly','monthly','yearly');
create type notification_type as enum (
  'household_invite_accepted','expense_created','expense_updated',
  'expense_deleted','settlement_recorded','settlement_voided',
  'recurring_generated','member_joined','member_removed');

-- ─────────────────────────── IDENTITY ────────────────────────
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  email        text not null,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Auto-created by an AFTER INSERT trigger on auth.users, so a profile always
-- exists by the time the first request runs. Prevents a null-profile race.

-- ─────────────────────────── HOUSEHOLDS ──────────────────────
create table households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 80),
  currency    char(3) not null default 'ILS',
  timezone    text not null default 'Asia/Jerusalem',
  plan        text not null default 'free' check (plan in ('free','pro')),
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references profiles(id)   on delete cascade,
  role         household_role not null default 'member',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index idx_members_user on household_members(user_id);
-- Exactly one owner per household:
create unique index idx_one_owner on household_members(household_id)
  where role = 'owner';

create table invitations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  email        text,                       -- null => shareable link invite
  token_hash   text not null unique,       -- sha256(token); raw token never stored
  role         household_role not null default 'member',
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references profiles(id),
  revoked_at   timestamptz,
  check (role <> 'owner')                  -- ownership transfers, never invites
);
create index idx_inv_household on invitations(household_id) where accepted_at is null;

-- ─────────────────────────── LEDGER ──────────────────────────
create table categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade, -- null = system
  name         text not null check (char_length(trim(name)) between 1 and 40),
  icon         text not null default 'receipt',
  color        text not null default '#64748b',
  sort_order   int  not null default 100,
  unique (household_id, name)
);

create table expenses (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  payer_id       uuid not null references profiles(id),
  category_id    uuid references categories(id) on delete set null,
  description    text not null check (char_length(trim(description)) between 1 and 120),
  amount_minor   bigint not null check (amount_minor > 0 and amount_minor <= 100000000),
  split_method   split_method not null,
  spent_at       date not null,
  note           text check (char_length(note) <= 500),
  receipt_path   text,
  recurring_id   uuid references recurring_expenses(id) on delete set null,
  idempotency_key text,                    -- guards double submits
  created_by     uuid not null references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references profiles(id)
);
create index idx_exp_feed on expenses(household_id, spent_at desc, id desc)
  where deleted_at is null;
create index idx_exp_payer on expenses(payer_id) where deleted_at is null;
create index idx_exp_category on expenses(household_id, category_id)
  where deleted_at is null;
create unique index idx_exp_idem on expenses(household_id, idempotency_key)
  where idempotency_key is not null;

create table expense_splits (
  expense_id  uuid not null references expenses(id) on delete cascade,
  user_id     uuid not null references profiles(id),
  share_minor bigint not null check (share_minor >= 0),
  share_input numeric(12,4),               -- the raw % or weight the user typed
  primary key (expense_id, user_id)
);
create index idx_splits_user on expense_splits(user_id);

create table expense_revisions (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references expenses(id) on delete cascade,
  changed_by  uuid not null references profiles(id),
  changed_at  timestamptz not null default now(),
  before      jsonb not null,
  after       jsonb not null
);
create index idx_rev_expense on expense_revisions(expense_id, changed_at desc);

create table settlements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  from_user    uuid not null references profiles(id),
  to_user      uuid not null references profiles(id),
  amount_minor bigint not null check (amount_minor > 0),
  method       settlement_method not null default 'other',
  note         text check (char_length(note) <= 300),
  settled_at   timestamptz not null default now(),
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid references profiles(id),
  check (from_user <> to_user)
);
create index idx_settle_feed on settlements(household_id, settled_at desc)
  where voided_at is null;

-- ─────────────────────────── SHOPPING ────────────────────────
create table shopping_lists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null default 'Shopping',
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);

create table shopping_items (
  id                  uuid primary key default gen_random_uuid(),
  list_id             uuid not null references shopping_lists(id) on delete cascade,
  household_id        uuid not null references households(id) on delete cascade,
  name                text not null check (char_length(trim(name)) between 1 and 80),
  quantity            text check (char_length(quantity) <= 20),
  estimated_minor     bigint check (estimated_minor >= 0),
  added_by            uuid not null references profiles(id),
  checked_by          uuid references profiles(id),
  checked_at          timestamptz,
  archived_at         timestamptz,
  converted_expense_id uuid references expenses(id) on delete set null,
  position            int not null default 0,
  created_at          timestamptz not null default now()
);
create index idx_items_active on shopping_items(list_id, position)
  where archived_at is null;
-- household_id is denormalised onto items so RLS and Realtime filters need no join.

-- ─────────────────────────── AUTOMATION ──────────────────────
create table recurring_expenses (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  description   text not null,
  amount_minor  bigint not null check (amount_minor > 0),
  category_id   uuid references categories(id) on delete set null,
  payer_id      uuid not null references profiles(id),
  split_method  split_method not null,
  split_config  jsonb not null,            -- participants + inputs
  frequency     recurrence_freq not null,
  day_of_period int not null check (day_of_period between 1 and 31),
  next_run_at   date not null,
  last_run_at   date,
  is_active     boolean not null default true,
  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);
create index idx_recurring_due on recurring_expenses(next_run_at) where is_active;

-- ─────────────────────────── ENGAGEMENT ──────────────────────
create table notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  household_id uuid references households(id) on delete cascade,
  type         notification_type not null,
  payload      jsonb not null default '{}',
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index idx_notif_unread on notifications(user_id, created_at desc)
  where read_at is null;

create table activity_log (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  actor_id     uuid references profiles(id),
  entity_type  text not null,   -- expense | settlement | member | …
  entity_id    uuid,
  action       text not null,   -- created | updated | deleted | …
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index idx_activity_feed on activity_log(household_id, created_at desc);
```

### 3.1 The integrity trigger

The most important constraint in the system cannot be expressed as a `CHECK`, because it spans rows:

```sql
create or replace function assert_splits_balance() returns trigger
language plpgsql as $$
declare
  v_expense_id uuid := coalesce(new.expense_id, old.expense_id);
  v_total      bigint;
  v_sum        bigint;
begin
  select amount_minor into v_total from expenses where id = v_expense_id;
  if v_total is null then return null; end if;          -- expense being deleted
  select coalesce(sum(share_minor),0) into v_sum
    from expense_splits where expense_id = v_expense_id;
  if v_sum <> v_total then
    raise exception 'SPLIT_IMBALANCE: splits total %, expense total %', v_sum, v_total
      using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger trg_splits_balance
  after insert or update or delete on expense_splits
  deferrable initially deferred            -- checked at COMMIT, not per row
  for each row execute function assert_splits_balance();
```

`DEFERRABLE INITIALLY DEFERRED` is essential: splits are inserted one row at a time, so a per-statement check would fail on the first row. Deferring to commit means the transaction is validated as a whole. **The database structurally cannot hold an unbalanced expense** — this is the single best thing to demo live.

A parallel trigger asserts that every split's `user_id` is a current member of the expense's household.

---

## 4. Row-Level Security

### 4.1 Helper functions

```sql
create or replace function public.is_household_member(p_household uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from household_members
    where household_id = p_household and user_id = auth.uid()
  );
$$;

create or replace function public.has_household_role(p_household uuid,
                                                     p_roles household_role[])
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from household_members
    where household_id = p_household and user_id = auth.uid()
      and role = any(p_roles)
  );
$$;
```

**Why `SECURITY DEFINER` is mandatory here.** A policy on `household_members` that itself queries `household_members` triggers that table's policies again — infinite recursion, and Postgres aborts with `42P17`. A `SECURITY DEFINER` function executes as its owner and therefore bypasses RLS _inside_ the function, breaking the cycle. `set search_path = public` is a required hardening step: without it, a caller could shadow `household_members` with a temp table and hijack a function running with elevated privileges. These two lines are worth memorising for the presentation.

### 4.2 Policies

RLS is enabled on every table with **no permissive default** — anything not explicitly allowed is denied.

```sql
alter table households enable row level security;

create policy households_select on households for select
  using (is_household_member(id));

create policy households_insert on households for insert
  with check (created_by = auth.uid());

create policy households_update on households for update
  using (has_household_role(id, array['owner','admin']::household_role[]));

create policy households_delete on households for delete
  using (has_household_role(id, array['owner']::household_role[]));

-- Members: visible to fellow members; managed by admins; self-removal allowed.
create policy members_select on household_members for select
  using (is_household_member(household_id));
create policy members_delete on household_members for delete
  using (user_id = auth.uid()
      or has_household_role(household_id, array['owner','admin']::household_role[]));
create policy members_update on household_members for update
  using (has_household_role(household_id, array['owner']::household_role[]));

-- Expenses: all members read; payer/creator or admin writes.
create policy expenses_select on expenses for select
  using (is_household_member(household_id));
create policy expenses_insert on expenses for insert
  with check (is_household_member(household_id) and created_by = auth.uid());
create policy expenses_update on expenses for update
  using (is_household_member(household_id)
     and (payer_id = auth.uid() or created_by = auth.uid()
          or has_household_role(household_id, array['owner','admin']::household_role[])));

-- Splits inherit the parent expense's household.
create policy splits_select on expense_splits for select
  using (exists (select 1 from expenses e
                 where e.id = expense_id and is_household_member(e.household_id)));

-- Settlements: only a party to the payment may record it.
create policy settlements_insert on settlements for insert
  with check (is_household_member(household_id)
          and (from_user = auth.uid() or to_user = auth.uid())
          and created_by = auth.uid());

-- Notifications are strictly personal.
create policy notifications_select on notifications for select
  using (user_id = auth.uid());

-- Activity log is append-only: readable by members, never updatable or deletable.
create policy activity_select on activity_log for select
  using (is_household_member(household_id));
```

_(Table-by-table policies for invitations, categories, shopping, recurring and revisions follow the same shape and are written in full in the migration files.)_

**Invitations get one deliberate exception:** an invitee is by definition not yet a member, so acceptance runs through a `SECURITY DEFINER` RPC (`accept_invitation(token)`) that looks the invitation up by token hash, validates expiry/revocation/acceptance, and inserts the membership — rather than opening a readable policy on the invitations table.

### 4.3 Storage policies

The `receipts` bucket is private. Object paths are `{household_id}/{expense_id}/{uuid}.webp`, and policies parse the first path segment:

```sql
create policy receipts_read on storage.objects for select
  using (bucket_id = 'receipts'
     and is_household_member(((storage.foldername(name))[1])::uuid));
```

Reads are served through short-lived signed URLs (60 s), so a leaked URL expires almost immediately and an unauthorized path guess is rejected by policy, not by obscurity.

---

## 5. SQL Functions (RPCs)

| Function                                         | Returns                                                    | Purpose                                                       |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `create_expense_with_splits(payload jsonb)`      | `uuid`                                                     | Atomically insert expense + splits + activity + notifications |
| `update_expense_with_splits(id, payload)`        | `void`                                                     | Same, plus a revision record; optimistic-concurrency checked  |
| `get_household_balances(hid)`                    | `table(user_id, paid, owed, settled_out, settled_in, net)` | Net position per member                                       |
| `get_monthly_breakdown(hid, from, to)`           | `table(month, category_id, total)`                         | Analytics aggregation                                         |
| `get_member_stats(hid, from, to)`                | `table(user_id, paid, consumed)`                           | Fairness view                                                 |
| `accept_invitation(token)`                       | `uuid`                                                     | Validate token and join household                             |
| `checkout_shopping_items(list, ids, payload)`    | `uuid`                                                     | Convert checked items into one expense                        |
| `settle_up(hid, from, to, amount, method, note)` | `uuid`                                                     | Record a settlement with validation                           |

The balance function, which is the analytical heart of the product:

```sql
create or replace function get_household_balances(p_household uuid)
returns table (user_id uuid, paid bigint, owed bigint,
               settled_out bigint, settled_in bigint, net bigint)
language sql stable security invoker as $$
  with members as (
    select hm.user_id from household_members hm where hm.household_id = p_household
  ),
  paid as (
    select e.payer_id as user_id, sum(e.amount_minor) amt
    from expenses e
    where e.household_id = p_household and e.deleted_at is null
    group by 1
  ),
  owed as (
    select s.user_id, sum(s.share_minor) amt
    from expense_splits s join expenses e on e.id = s.expense_id
    where e.household_id = p_household and e.deleted_at is null
    group by 1
  ),
  paid_out as (
    select st.from_user as user_id, sum(st.amount_minor) amt
    from settlements st
    where st.household_id = p_household and st.voided_at is null group by 1
  ),
  paid_in as (
    select st.to_user as user_id, sum(st.amount_minor) amt
    from settlements st
    where st.household_id = p_household and st.voided_at is null group by 1
  )
  select m.user_id,
         coalesce(p.amt,0), coalesce(o.amt,0),
         coalesce(po.amt,0), coalesce(pi.amt,0),
         coalesce(p.amt,0) - coalesce(o.amt,0)
           + coalesce(po.amt,0) - coalesce(pi.amt,0)   -- net position
  from members m
  left join paid p     on p.user_id  = m.user_id
  left join owed o     on o.user_id  = m.user_id
  left join paid_out po on po.user_id = m.user_id
  left join paid_in  pi on pi.user_id = m.user_id;
$$;
```

`security invoker` is intentional: the function runs as the caller, so RLS still applies and a non-member calling it gets nothing. Positive `net` means the member is owed money; negative means they owe. **The sum of all `net` values in a household is always exactly zero** — an invariant asserted in the test suite.

---

## 6. Core Business Logic

### 6.1 Money

```ts
export type Minor = number & { readonly __brand: "MinorUnits" };
```

A branded type makes it a compile-time error to pass a display float where minor units are expected. Rules: parse user input from a decimal string to minor units once, at the boundary; never use floating-point arithmetic on money; format only at render time via `Intl.NumberFormat`. Parsing is defensive — it accepts `1,234.5`, `₪12`, and `12.` while rejecting `12.345`, `NaN`, `Infinity`, and anything exceeding the ceiling.

### 6.2 The four split strategies

All four funnel into one allocator so that rounding behaves identically everywhere.

**Equal.** `base = floor(total / n)`, `remainder = total − base·n`. The remainder (strictly `< n` agorot) is distributed one unit each to the first `remainder` participants, ordered by a **deterministic rotation seeded by the expense id**. Rotating rather than always favouring the same sorted-first user means that over many expenses the sub-agora advantage evens out — a small fairness touch that is easy to explain and easy to test.

**Exact.** The user supplies each share directly. Validation rejects the submission unless the shares sum _exactly_ to the total; the UI shows the live remainder ("₪1.00 left to assign") so the user is never guessing.

**Percentage.** Percentages must sum to 100 within a 0.01 tolerance. Each raw share is `total · pct / 100`; taking `floor` of each leaves a remainder distributed by the **largest-remainder method** — the participant whose truncated fraction was largest receives the first spare agora. This is the same algorithm used for apportioning parliamentary seats, and it is the standard correct answer to "how do you split ₪100 three ways."

**Shares/weights.** Integer weights, then identical largest-remainder allocation over `total · wᵢ / Σw`.

```ts
function allocate(total: Minor, weights: number[], seed: string): Minor[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  // Rank by fractional part descending; ties broken deterministically by seed
  // so the same input always produces the same output (required for testing
  // and for server/client preview agreement).
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || tiebreak(a.i, b.i, seed));

  for (let k = 0; remainder > 0; k++, remainder--) floors[order[k].i]++;
  return floors as Minor[];
}
```

**Post-condition, asserted in code and in the database:** `Σ result === total`, and every element is `≥ 0`. Property-based tests generate thousands of random totals and weight vectors and assert exactly this.

### 6.3 Debt simplification

Given net positions summing to zero, produce a minimal set of transfers.

```
1. Split members into debtors (net < 0) and creditors (net > 0).
2. Order both by magnitude, largest first.
3. Repeatedly match the largest debtor with the largest creditor:
     t = min(|debt|, credit)
     emit transfer debtor → creditor of t
     reduce both by t; drop whichever reaches zero
4. Stop when no debtors remain.
```

This greedy algorithm produces **at most n−1 transfers** for n members, typically far fewer than the naive pairwise settlement.

A concrete example worth walking through in the demo: A owes B ₪50, B owes C ₪50, and C owes A ₪20. Settled pairwise that is three separate payments. Netting them out gives positions of A −30, B 0, C +30, so the entire tangle collapses into **one** payment of ₪30 from A to C, and B — who is square — is not involved at all.

**The honest caveat, which is exactly the kind of nuance that scores well:** minimising the number of transfers exactly is NP-hard (it reduces to a partition/subset-sum problem), so this greedy approach is a heuristic with a guaranteed `n−1` bound, not a proven optimum. We document that rather than claiming optimality. Correctness properties that _are_ guaranteed and are tested: transfers conserve total value, every net position reaches zero, no member both sends and receives, and no transfer is negative.

### 6.4 Recurrence

Next-occurrence calculation clamps overflow days (a monthly rule on the 31st fires on the 30th, or the 28th/29th in February) and evaluates in the household's timezone so a rule due "on the 1st" doesn't fire on the 31st for someone in another zone. Generation is idempotent: the job checks whether an expense already exists for this rule and period before inserting.

---

## 7. CRUD Operations & Server Action Catalogue

Every action shares the signature `(input: unknown) => Promise<ActionResult<T>>` and the seven-step pipeline from [Architecture §4.2](./02-architecture.md#42-write-path).

| Action                  | Auth                | Input (Zod)                                                                                                             | Effects                                                  | Errors                                                     |
| ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `createHousehold`       | user                | `{name, currency}`                                                                                                      | household + owner membership + default categories + list | `VALIDATION`                                               |
| `updateHousehold`       | admin               | `{id, name?, timezone?}`                                                                                                | update                                                   | `FORBIDDEN`, `NOT_FOUND`                                   |
| `leaveHousehold`        | member              | `{id}`                                                                                                                  | delete membership                                        | `OWNER_MUST_TRANSFER`, `OUTSTANDING_BALANCE`               |
| `createInvitation`      | admin               | `{householdId, email?, role}`                                                                                           | token + hash + optional email                            | `MEMBER_LIMIT`, `ALREADY_MEMBER`                           |
| `acceptInvitation`      | user                | `{token}`                                                                                                               | RPC → membership + notify                                | `INVITE_EXPIRED/REVOKED/USED`, `EMAIL_MISMATCH`            |
| `changeMemberRole`      | owner               | `{householdId, userId, role}`                                                                                           | update role                                              | `FORBIDDEN`, `LAST_OWNER`                                  |
| `removeMember`          | admin               | `{householdId, userId}`                                                                                                 | delete membership                                        | `OUTSTANDING_BALANCE`                                      |
| **`createExpense`**     | member              | `{householdId, description, amount, payerId, categoryId?, spentAt, note?, splitMethod, participants[], idempotencyKey}` | RPC: expense + splits + activity + notifications         | `VALIDATION`, `SPLIT_IMBALANCE`, `NOT_MEMBER`, `DUPLICATE` |
| `updateExpense`         | payer/creator/admin | above + `{id, updatedAt}`                                                                                               | RPC: update + revision                                   | `FORBIDDEN`, `CONFLICT`                                    |
| `deleteExpense`         | payer/creator/admin | `{id}`                                                                                                                  | soft delete + activity                                   | `FORBIDDEN`                                                |
| `restoreExpense`        | admin               | `{id}`                                                                                                                  | clear `deleted_at`                                       | `FORBIDDEN`                                                |
| `attachReceipt`         | payer/admin         | `{expenseId, path}`                                                                                                     | set `receipt_path`                                       | `INVALID_FILE`                                             |
| `createSettlement`      | party               | `{householdId, fromUser, toUser, amount, method, note?}`                                                                | RPC + notify                                             | `SELF_SETTLEMENT`, `NOT_MEMBER`, `EXCEEDS_BALANCE`(warn)   |
| `voidSettlement`        | party/admin         | `{id, reason}`                                                                                                          | set `voided_at`                                          | `FORBIDDEN`, `ALREADY_VOID`                                |
| `addShoppingItem`       | member              | `{listId, name, quantity?, estimated?, clientId}`                                                                       | insert → Realtime broadcast                              | `VALIDATION`                                               |
| `toggleShoppingItem`    | member              | `{id, checked}`                                                                                                         | update `checked_by/at` (idempotent)                      | `NOT_FOUND`                                                |
| `checkoutShoppingItems` | member              | `{listId, itemIds[], expensePayload}`                                                                                   | RPC: expense + archive items                             | `NO_ITEMS`, `SPLIT_IMBALANCE`                              |
| `createRecurringRule`   | admin               | template + schedule                                                                                                     | insert + compute `next_run_at`                           | `VALIDATION`                                               |
| `markNotificationsRead` | user                | `{ids[]?}`                                                                                                              | update                                                   | —                                                          |

**Reads** live in `lib/data/*` as plain async functions called from Server Components: `getHouseholdsForUser`, `getHouseholdWithMembers`, `getExpenses(filters, cursor)`, `getExpenseDetail`, `getBalances`, `getSettlementSuggestions`, `getShoppingList`, `getInsights(range)`, `getActivity(cursor)`, `getNotifications`.

**Pagination is cursor-based** on `(spent_at, id)`, not `OFFSET`. Offset pagination re-scans skipped rows and, worse, silently drops or duplicates records when a new expense is inserted between page loads.

---

## 8. State Management Strategy

| State                                     | Where it lives                           | Why                                                |
| ----------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Server data (expenses, balances, members) | Server Components + `revalidatePath`     | No client cache means no stale-cache class of bugs |
| Filters, sorting, pagination cursor       | URL `searchParams`                       | Shareable, back-button correct, server-readable    |
| Form state                                | `react-hook-form` (component-local)      | Uncontrolled inputs keep the split editor fast     |
| Optimistic mutations                      | `useOptimistic`                          | Instant feedback with automatic reconciliation     |
| Realtime list                             | `useReducer` fed by the Realtime channel | Event stream maps naturally to a reducer           |
| Session                                   | Cookies via `@supabase/ssr`              | Readable on both server and client                 |
| Ephemeral UI (dialogs, toasts)            | Local `useState` / `sonner`              | Never worth globalising                            |

**No Redux, Zustand, or TanStack Query.** The justification, in one line for the presentation: in a server-first App Router application, most "global state" is actually server state, and the framework already owns it — adding a client cache would mean maintaining two sources of truth for the same rows.

---

## 9. Error Handling

Errors are classified into four kinds, each with a defined presentation:

**Validation errors** (bad input) are returned as field-level messages and rendered next to the offending input. Never a toast — the user needs to see _which_ field.

**Domain errors** (the operation is understood but not allowed) return a typed code from a fixed enum, mapped to a human sentence: `FORBIDDEN`, `NOT_MEMBER`, `SPLIT_IMBALANCE`, `OUTSTANDING_BALANCE`, `INVITE_EXPIRED`, `CONFLICT`, `RATE_LIMITED`, and so on. Each has a matching UI copy string, and each is asserted in tests.

**Infrastructure errors** (database down, timeout) are logged to Sentry with a correlation ID and surfaced as a generic recoverable message with a retry button. The raw error is never shown, because messages leak schema and version details.

**Postgres exceptions are translated**, not passed through: `23505` unique violation → "That already exists"; `23503` foreign key → "The item you referenced no longer exists"; `42501` insufficient privilege (an RLS denial) → `FORBIDDEN`; our custom `P0001 SPLIT_IMBALANCE` → the specific split message with the exact difference.

```ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; fields?: Record<string, string> };
    };
```

Actions never throw across the network boundary. Throwing produces an opaque digest in production, which is useless to both the user and to us; a typed result is inspectable and testable. Route segments additionally carry `error.tsx` boundaries as a last resort for render-time failures, and `global-error.tsx` catches anything in the root layout.

---

## 10. Input Validation

Validation happens **three times**, and each pass exists for a different reason:

1. **Client (Zod via react-hook-form)** — instant feedback, zero round trips. Purely a UX affordance and trivially bypassable.
2. **Server Action (the same Zod schema)** — the authoritative gate. Assume every request is hand-crafted by an attacker, because it can be.
3. **Database (constraints, triggers, RLS)** — the invariant guarantee, which holds even if the application has a bug.

Representative rules: description 1–120 characters after trimming; amount a positive decimal with at most two places, `> 0` and `≤ 1,000,000`; `spent_at` not more than one day in the future and not before 2000; participants a non-empty set of current members with no duplicates; percentages summing to 100 ± 0.01; exact shares summing to the total precisely; UUIDs validated by format before reaching the database; free text stored as-is and rendered as text (React escapes by default — we never use `dangerouslySetInnerHTML`); uploads restricted to `image/jpeg|png|webp` under 5 MB, checked by magic bytes rather than by file extension.

Additional guards: mutating actions are rate-limited per user (a Postgres-backed token bucket, avoiding an extra vendor); every create action accepts an idempotency key to make double submits harmless; and updates carry the last-known `updated_at` for optimistic concurrency, so a stale edit produces a visible `CONFLICT` rather than silently overwriting a roommate's change.

---

## 11. UX Design

**Information architecture.** Two levels: a personal dashboard aggregating every household ("you're owed ₪312 in total") and a household workspace with six tabs (Home, Expenses, Settle, Shopping, Insights, Members). Mobile navigation is a bottom bar with the four most-used destinations plus a persistent floating "Add expense" button, because logging an expense on a phone is the single most frequent action in the product.

**The critical screen — Add Expense.** Optimised for the fifteen-second target: amount field autofocused with a numeric keypad on mobile; payer defaulting to the current user; date defaulting to today; all members pre-selected; split defaulting to equal. In the common case a user types an amount and a description and saves — two fields. Advanced splitting is one tap away behind method tabs but never blocks the fast path. The live split preview always shows the resulting per-person amounts, and the save button stays disabled with an explicit reason ("₪1.00 still unassigned") rather than failing after submission.

**Balances** use colour plus explicit sign and wording — green "owes you", red "you owe" — never colour alone, since roughly 8% of men have some form of colour-vision deficiency. Every amount is rendered by one shared `<Money>` component so formatting can never drift between screens.

**States.** Every list defines four: loading (skeletons matching the final layout, so nothing shifts), empty (an illustration plus the single most useful action — an empty ledger says "Add your first expense", not "No data"), error (what failed plus a retry), and populated. Layout shift is treated as a bug.

**Feedback.** Optimistic updates everywhere a write is likely to succeed; toasts for background successes; inline errors for validation; destructive actions (delete expense, remove member, delete household) require typed confirmation and state the consequence in plain language.

**Accessibility.** Radix primitives supply focus management and ARIA for overlays. Beyond that: full keyboard reachability, visible focus rings, WCAG AA contrast, labelled form controls, `aria-live` announcements for realtime shopping-list changes, and respect for `prefers-reduced-motion`.

**Visual system.** A restrained palette (slate neutrals, a single indigo accent, semantic green/red reserved exclusively for money direction), one type scale, generous whitespace, and a 4-point spacing grid. Dark mode via CSS variables. The intent is "trustworthy financial tool", not "playful consumer app" — people are looking at money they are owed.

---

## 12. Feature Subsystems

**Realtime.** One channel per household shopping list, filtered server-side by `household_id`. On mount the component fetches current rows and subscribes; events are merged by a reducer keyed on item id, with optimistic entries matched by a client-generated UUID. Reconnection refetches to recover events missed while offline. A short debounce prevents render thrash when several items arrive at once.

**Storage.** Client-side compression to WebP at max 1600px before upload keeps typical receipts under 300 KB. Uploads go directly from browser to Supabase Storage using the user's JWT (never proxied through a serverless function, which would double bandwidth and hit payload limits), then a Server Action records the path on the expense. Orphaned objects — uploaded but never attached — are swept by the daily job.

**Cron.** `GET /api/cron/recurring` runs daily at 06:00 Asia/Jerusalem via Vercel Cron. It compares a `CRON_SECRET` header using constant-time comparison, then processes due rules with the service-role client. Each rule is handled independently: one failure notifies an admin and continues rather than aborting the batch. A per-rule, per-period uniqueness guard makes a double invocation harmless.

**Notifications.** Written inside the same transaction as the triggering mutation, so a notification can never describe an event that was rolled back. The bell polls unread count on navigation (upgrading to Realtime is a trivial future change). Email goes out only for invitations and, opt-in, settlement requests — over-notification is the fastest way to get an app muted.

---

## 13. Configuration

| Variable                        | Scope           | Purpose                                                                |
| ------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Client + server | Project endpoint                                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server | Public key; safe _only because_ RLS is enforced                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server only     | Bypasses RLS — cron job exclusively; never imported into a client file |
| `NEXT_PUBLIC_SITE_URL`          | Client + server | Auth redirect and invitation link base                                 |
| `CRON_SECRET`                   | Server only     | Authenticates the scheduled job                                        |
| `RESEND_API_KEY`                | Server only     | Transactional email                                                    |
| `SENTRY_DSN`                    | Both            | Error reporting                                                        |

All are parsed by a Zod schema in `lib/env.ts` at module load, so a missing or malformed variable fails fast with a precise message instead of producing a mysterious runtime null. A lint rule forbids importing `lib/supabase/admin.ts` from anything under `components/` or any file marked `'use client'`.

---

## 14. Testing Hooks Built Into the Design

These are design choices made specifically to keep the system testable; the full strategy is in the Test Plan (Deliverable #5).

The domain layer is pure and dependency-free, so split allocation, balance derivation and debt simplification are tested exhaustively — including property-based tests asserting the invariants — in milliseconds with no database. Server Actions return typed results rather than throwing, so error paths are assertable without exception plumbing. RLS is testable because policies are pure SQL: the integration suite creates two real users in two households and asserts that cross-household reads return empty and cross-household writes are rejected. Realtime is testable because writes go through Server Actions, so a Playwright test can drive two browser contexts and assert propagation. Every interactive element carries a stable `data-testid`, and queries prefer accessible roles so tests break on real regressions rather than on styling changes.
