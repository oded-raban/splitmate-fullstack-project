-- =============================================================================
-- SplitMate — 03. Row Level Security
-- =============================================================================
-- This file IS the authorization system. Application-level permission checks
-- exist as well, but they only produce nicer error messages; if they were all
-- deleted tomorrow, no user would gain access to another household's data.
--
-- THE MODEL
--   Every table has RLS enabled and has no permissive fallback policy. Postgres
--   RLS is default-deny: an operation with no matching policy is refused. So
--   anything not explicitly granted below is impossible through the API,
--   including from a hand-crafted request carrying a valid JWT.
--
-- WHY THE HELPER FUNCTIONS ARE `SECURITY DEFINER`
--   The natural policy for `household_members` is "you may read rows of a
--   household you are a member of" — which requires querying household_members
--   from inside a policy on household_members. Postgres re-applies the table's
--   policies to that inner query, which recurses infinitely and aborts with
--   error 42P17.
--
--   A SECURITY DEFINER function executes with its owner's privileges, and the
--   table owner is exempt from RLS, so the query inside the function does not
--   re-trigger policy evaluation. That breaks the cycle.
--
--   `set search_path = public` is not optional decoration. A SECURITY DEFINER
--   function runs elevated; if an attacker could put their own `household_members`
--   table earlier on the search path, the elevated function would read theirs.
--   Pinning the path removes that attack.
--
--   The functions are `stable`, so Postgres evaluates each one once per query
--   rather than once per row — the difference between a fast policy and one
--   that makes every list view quadratic.
-- =============================================================================


-- =============================================================================
-- HELPER PREDICATES
-- =============================================================================

-- Is the caller a member of this household? The single question almost every
-- policy in the system reduces to.
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = p_household_id
      and user_id = auth.uid()
  );
$$;

-- Does the caller hold one of these roles in this household?
-- Takes an array so a policy can express "owner or admin" in one call.
create or replace function public.has_household_role(
  p_household_id uuid,
  p_roles public.household_role[]
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = p_household_id
      and user_id = auth.uid()
      and role = any (p_roles)
  );
$$;

-- Do the caller and this other user share at least one household? Used to
-- decide whose profile the caller may read: you can see the name and avatar of
-- people you live with, and nobody else.
create or replace function public.shares_household_with(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs
      on theirs.household_id = mine.household_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
  );
$$;

-- May the caller modify this expense? Encodes the rule from PRD §8.1: the payer
-- or the person who logged it can edit it, and admins/owners can edit anything.
-- Extracted into a function because it is needed by four policies across three
-- tables (expenses, expense_splits, expense_revisions) and duplicating it would
-- guarantee the copies eventually diverge.
create or replace function public.can_modify_expense(p_expense_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.expenses e
    where e.id = p_expense_id
      and (
        e.payer_id = auth.uid()
        or e.created_by = auth.uid()
        or public.has_household_role(
             e.household_id, array['owner', 'admin']::public.household_role[]
           )
      )
  );
$$;

-- Membership check for an arbitrary user (not the caller). Needed when writing
-- rows *about* another member, e.g. a notification addressed to a housemate.
create or replace function public.is_member_of(p_household_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = p_household_id
      and user_id = p_user_id
  );
$$;


-- =============================================================================
-- ENABLE RLS EVERYWHERE
-- =============================================================================
-- Enabling RLS on a table with no policies denies everything. Every table is
-- switched on here first, so a table added later without policies fails closed
-- rather than open.
alter table public.profiles           enable row level security;
alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.invitations        enable row level security;
alter table public.categories         enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.expenses           enable row level security;
alter table public.expense_splits     enable row level security;
alter table public.expense_revisions  enable row level security;
alter table public.settlements        enable row level security;
alter table public.shopping_lists     enable row level security;
alter table public.shopping_items     enable row level security;
alter table public.notifications      enable row level security;
alter table public.activity_log       enable row level security;


-- =============================================================================
-- PROFILES
-- =============================================================================
-- Readable: yourself, plus anyone you share a household with. Deliberately NOT
-- "any authenticated user" — that would turn the app into a directory of every
-- registered person's name, avatar and email.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_household_with(id));

-- You may edit only your own profile. WITH CHECK repeats the condition so a row
-- cannot be updated to belong to somebody else.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT policy: profiles are created exclusively by the auth.users trigger.
-- No DELETE policy: profiles disappear only when the auth user is deleted.


-- =============================================================================
-- HOUSEHOLDS
-- =============================================================================
create policy households_select on public.households
  for select to authenticated
  using (public.is_household_member(id));

create policy households_update on public.households
  for update to authenticated
  using (public.has_household_role(id, array['owner', 'admin']::public.household_role[]))
  with check (public.has_household_role(id, array['owner', 'admin']::public.household_role[]));

create policy households_delete on public.households
  for delete to authenticated
  using (public.has_household_role(id, array['owner']::public.household_role[]));

-- No INSERT policy. Creating a household means inserting the household AND the
-- owner's membership row, and between those two statements the creator is not
-- yet a member — so no membership-based policy could authorise the second
-- insert. That bootstrap is handled atomically by the create_household() RPC
-- (migration 04), which is the only sanctioned path.


-- =============================================================================
-- HOUSEHOLD MEMBERS
-- =============================================================================
create policy members_select on public.household_members
  for select to authenticated
  using (public.is_household_member(household_id));

-- Only the owner changes roles (promoting an admin, transferring ownership).
create policy members_update on public.household_members
  for update to authenticated
  using (public.has_household_role(household_id, array['owner']::public.household_role[]))
  with check (public.has_household_role(household_id, array['owner']::public.household_role[]));

-- Leaving is self-service; removing someone else requires admin or owner.
create policy members_delete on public.household_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.has_household_role(
         household_id, array['owner', 'admin']::public.household_role[]
       )
  );

-- No INSERT policy: membership is granted only by create_household() or
-- accept_invitation(), both of which validate an invitation token first.


-- =============================================================================
-- INVITATIONS
-- =============================================================================
-- Only admins and owners can see pending invitations — the list reveals which
-- email addresses have been invited, which ordinary members have no need for.
create policy invitations_select on public.invitations
  for select to authenticated
  using (public.has_household_role(
    household_id, array['owner', 'admin']::public.household_role[]
  ));

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    public.has_household_role(
      household_id, array['owner', 'admin']::public.household_role[]
    )
    -- Prevents forging an invitation that appears to come from someone else.
    and created_by = auth.uid()
  );

-- UPDATE is how an invitation is revoked (setting revoked_at).
create policy invitations_update on public.invitations
  for update to authenticated
  using (public.has_household_role(
    household_id, array['owner', 'admin']::public.household_role[]
  ))
  with check (public.has_household_role(
    household_id, array['owner', 'admin']::public.household_role[]
  ));

-- Note: the invitee cannot read this table at all — by definition they are not
-- yet a member of the household. Acceptance goes through accept_invitation(),
-- which looks the row up by token hash inside a SECURITY DEFINER function.


-- =============================================================================
-- CATEGORIES
-- =============================================================================
create policy categories_select on public.categories
  for select to authenticated
  using (household_id is null or public.is_household_member(household_id));

create policy categories_insert on public.categories
  for insert to authenticated
  with check (
    household_id is not null
    and public.has_household_role(
      household_id, array['owner', 'admin']::public.household_role[]
    )
  );

create policy categories_update on public.categories
  for update to authenticated
  using (
    household_id is not null
    and public.has_household_role(
      household_id, array['owner', 'admin']::public.household_role[]
    )
  )
  with check (
    household_id is not null
    and public.has_household_role(
      household_id, array['owner', 'admin']::public.household_role[]
    )
  );

create policy categories_delete on public.categories
  for delete to authenticated
  using (
    household_id is not null
    and public.has_household_role(
      household_id, array['owner', 'admin']::public.household_role[]
    )
  );


-- =============================================================================
-- RECURRING EXPENSES
-- =============================================================================
-- All members can see what bills are scheduled (transparency), but only admins
-- can create or change them, because a recurring rule silently generates money
-- movements every month.
create policy recurring_select on public.recurring_expenses
  for select to authenticated
  using (public.is_household_member(household_id));

create policy recurring_insert on public.recurring_expenses
  for insert to authenticated
  with check (
    public.has_household_role(
      household_id, array['owner', 'admin']::public.household_role[]
    )
    and created_by = auth.uid()
  );

create policy recurring_update on public.recurring_expenses
  for update to authenticated
  using (public.has_household_role(
    household_id, array['owner', 'admin']::public.household_role[]
  ))
  with check (public.has_household_role(
    household_id, array['owner', 'admin']::public.household_role[]
  ));

create policy recurring_delete on public.recurring_expenses
  for delete to authenticated
  using (public.has_household_role(
    household_id, array['owner', 'admin']::public.household_role[]
  ));


-- =============================================================================
-- EXPENSES
-- =============================================================================
-- Every member reads every expense, including soft-deleted ones: the audit
-- trail is a feature, and filtering deleted rows is the application's job.
create policy expenses_select on public.expenses
  for select to authenticated
  using (public.is_household_member(household_id));

create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.is_household_member(household_id)
    -- You cannot log an expense while claiming someone else entered it.
    and created_by = auth.uid()
  );

-- Covers both editing and soft-deleting (which sets deleted_at).
-- The WITH CHECK clause re-tests membership on the NEW row, which is what stops
-- an expense from being moved into a household the caller is not part of.
create policy expenses_update on public.expenses
  for update to authenticated
  using (public.can_modify_expense(id))
  with check (
    public.is_household_member(household_id)
    and public.can_modify_expense(id)
  );

-- No DELETE policy: expenses are soft-deleted so the ledger is never rewritten.


-- =============================================================================
-- EXPENSE SPLITS
-- =============================================================================
-- Splits have no household_id of their own; they inherit everything from their
-- parent expense. Note the subqueries below read `public.expenses`, which is
-- itself protected by RLS — so a caller who cannot see the expense cannot see
-- or touch its splits either. The protection composes automatically.
create policy splits_select on public.expense_splits
  for select to authenticated
  using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id
        and public.is_household_member(e.household_id)
    )
  );

create policy splits_insert on public.expense_splits
  for insert to authenticated
  with check (public.can_modify_expense(expense_id));

create policy splits_update on public.expense_splits
  for update to authenticated
  using (public.can_modify_expense(expense_id))
  with check (public.can_modify_expense(expense_id));

-- Splits are genuinely deleted (not soft deleted) when an expense is re-split:
-- an obsolete split row is not history, it is a wrong number. The expense's
-- revision record preserves what the old split was.
create policy splits_delete on public.expense_splits
  for delete to authenticated
  using (public.can_modify_expense(expense_id));


-- =============================================================================
-- EXPENSE REVISIONS
-- =============================================================================
create policy revisions_select on public.expense_revisions
  for select to authenticated
  using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id
        and public.is_household_member(e.household_id)
    )
  );

create policy revisions_insert on public.expense_revisions
  for insert to authenticated
  with check (
    public.can_modify_expense(expense_id)
    and changed_by = auth.uid()
  );

-- No UPDATE or DELETE policy: history is immutable.


-- =============================================================================
-- SETTLEMENTS
-- =============================================================================
create policy settlements_select on public.settlements
  for select to authenticated
  using (public.is_household_member(household_id));

-- You may only record a payment you were actually part of. Without the
-- party check, any member could invent a payment between two other people and
-- silently clear a debt that was never paid.
create policy settlements_insert on public.settlements
  for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and (from_user = auth.uid() or to_user = auth.uid())
    and created_by = auth.uid()
  );

-- UPDATE exists to void a settlement. Either party can dispute it; admins can
-- clean up mistakes.
create policy settlements_update on public.settlements
  for update to authenticated
  using (
    public.is_household_member(household_id)
    and (
      from_user = auth.uid()
      or to_user = auth.uid()
      or public.has_household_role(
           household_id, array['owner', 'admin']::public.household_role[]
         )
    )
  )
  with check (public.is_household_member(household_id));

-- No DELETE policy: a settlement is voided, never erased.


-- =============================================================================
-- SHOPPING
-- =============================================================================
create policy lists_select on public.shopping_lists
  for select to authenticated
  using (public.is_household_member(household_id));

create policy lists_insert on public.shopping_lists
  for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and created_by = auth.uid()
  );

create policy lists_update on public.shopping_lists
  for update to authenticated
  using (public.has_household_role(
    household_id, array['owner', 'admin']::public.household_role[]
  ))
  with check (public.has_household_role(
    household_id, array['owner', 'admin']::public.household_role[]
  ));

create policy lists_delete on public.shopping_lists
  for delete to authenticated
  using (public.has_household_role(
    household_id, array['owner', 'admin']::public.household_role[]
  ));

-- Items are fully collaborative: anyone in the household can add, tick off,
-- rename or remove anything. That matches how a physical list on the fridge
-- works, and locking items to their author would make the feature useless.
--
-- `household_id` is set by a BEFORE trigger from the parent list, and WITH CHECK
-- runs after BEFORE triggers — so the value tested here is the derived one, not
-- whatever the client sent.
create policy items_select on public.shopping_items
  for select to authenticated
  using (public.is_household_member(household_id));

create policy items_insert on public.shopping_items
  for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and added_by = auth.uid()
  );

create policy items_update on public.shopping_items
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy items_delete on public.shopping_items
  for delete to authenticated
  using (public.is_household_member(household_id));


-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================
-- Strictly personal: a notification is readable only by its recipient, with no
-- household escape hatch. Even the household owner cannot read someone else's.
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- Marking as read.
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

-- No INSERT policy. Notifications are written only by the notify_users() helper
-- in migration 04, which runs SECURITY DEFINER. Granting members direct INSERT
-- would let one roommate fabricate a notification that appears to come from
-- the system ("Your rent was settled").


-- =============================================================================
-- ACTIVITY LOG
-- =============================================================================
-- SELECT only, by design. There is intentionally no INSERT, UPDATE or DELETE
-- policy, which makes the audit trail append-only *and* unforgeable from the
-- client: entries are written exclusively by the SECURITY DEFINER helper
-- log_activity(). Not even a household owner can rewrite history through the API.
create policy activity_select on public.activity_log
  for select to authenticated
  using (public.is_household_member(household_id));
