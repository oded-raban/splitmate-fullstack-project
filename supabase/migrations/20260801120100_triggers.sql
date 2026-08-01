-- =============================================================================
-- SplitMate — 02. Triggers and database-enforced invariants
-- =============================================================================
-- These are the rules that must hold no matter what code calls the database.
-- Application-level validation exists too (and gives far better error messages),
-- but application code can have bugs; a constraint cannot be forgotten.
--
-- Contents
--   1. updated_at maintenance
--   2. Profile bootstrap on signup
--   3. THE split-balance invariant  ← the most important rule in the system
--   4. Participants must be household members
--   5. Settlement parties must be household members
--   6. Shopping items inherit their list's household
-- =============================================================================


-- =============================================================================
-- 1. updated_at maintenance
-- =============================================================================
-- Doing this in the database rather than in application code means the column
-- is correct even for a manual SQL fix or a future service that we have not
-- written yet. Application code cannot forget it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_households_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

create trigger trg_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

create trigger trg_recurring_updated_at
  before update on public.recurring_expenses
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. Profile bootstrap on signup
-- =============================================================================
-- Supabase inserts into auth.users when a user signs up — a table we do not
-- control and cannot extend. This trigger mirrors the new user into
-- public.profiles in the SAME transaction, which guarantees that a profile
-- exists before the user's very first request.
--
-- Why not create the profile lazily in application code? Because two concurrent
-- requests from the same fresh session would both find no profile and both try
-- to insert one. Doing it here makes the race impossible.
--
-- SECURITY DEFINER is required: the signup happens as an unprivileged role that
-- has no rights on public.profiles. `set search_path` is a hardening measure —
-- without it, a caller could create a `profiles` table in a schema earlier on
-- the search path and have this elevated function write there instead.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  -- Prefer a real name from the OAuth provider; fall back to the local part of
  -- the email so the user is never shown a blank name. Google returns
  -- `full_name`/`name`; magic-link signups have neither.
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'New user'
  );

  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    -- The column caps display_name at 60 characters; truncate rather than let
    -- an unusually long provider name abort the signup transaction.
    left(v_display_name, 60),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  -- Idempotent: re-running signup for an existing id must not fail.
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- 3. THE split-balance invariant
-- =============================================================================
-- For every expense:  SUM(expense_splits.share_minor) = expenses.amount_minor
--
-- This cannot be a CHECK constraint, because a CHECK sees only one row and this
-- rule spans a parent row and all of its children.
--
-- The critical detail is DEFERRABLE INITIALLY DEFERRED. Splits are inserted one
-- row at a time, so after the first insert the sum is deliberately "wrong" —
-- an immediate trigger would reject every multi-participant expense. Deferring
-- to COMMIT validates the transaction as a whole, which is the only point at
-- which the question "do the splits balance?" is meaningful.
--
-- Consequence worth demonstrating: it is structurally impossible for this
-- database to contain an expense whose splits do not sum to its total. Not
-- unlikely — impossible.
create or replace function public.assert_splits_balance()
returns trigger
language plpgsql
as $$
declare
  v_expense_id uuid;
  v_total      bigint;
  v_sum        bigint;
begin
  -- On DELETE, `new` is null; on INSERT/UPDATE, `old` is null.
  v_expense_id := coalesce(new.expense_id, old.expense_id);

  select amount_minor into v_total
  from public.expenses
  where id = v_expense_id;

  -- The parent expense is gone: this is a cascading delete of the whole expense,
  -- not an unbalanced edit. Nothing to verify.
  if v_total is null then
    return null;
  end if;

  select coalesce(sum(share_minor), 0) into v_sum
  from public.expense_splits
  where expense_id = v_expense_id;

  if v_sum <> v_total then
    raise exception
      'SPLIT_IMBALANCE: splits total %, expense total % (difference %)',
      v_sum, v_total, v_total - v_sum
      using errcode = 'P0001',
            hint = 'Every participant share must add up to the expense amount.';
  end if;

  return null; -- AFTER triggers ignore the return value.
end;
$$;

create constraint trigger trg_splits_balance
  after insert or update or delete on public.expense_splits
  deferrable initially deferred
  for each row execute function public.assert_splits_balance();

-- The same invariant can also be broken from the parent side, by editing an
-- expense's amount without touching its splits. This second function closes
-- that hole. Both triggers are deferred, so an edit that changes the amount AND
-- rewrites the splits in one transaction is valid — only the end state is judged.
create or replace function public.assert_expense_amount_balance()
returns trigger
language plpgsql
as $$
declare
  v_sum bigint;
begin
  -- A soft-deleted expense is out of the ledger, so its splits no longer have
  -- to balance against anything.
  if new.deleted_at is not null then
    return null;
  end if;

  select coalesce(sum(share_minor), 0) into v_sum
  from public.expense_splits
  where expense_id = new.id;

  -- An expense with no splits at all is only ever a transient state inside a
  -- transaction that is about to insert them; by COMMIT the sum must match.
  if v_sum <> new.amount_minor then
    raise exception
      'SPLIT_IMBALANCE: splits total %, expense total % (difference %)',
      v_sum, new.amount_minor, new.amount_minor - v_sum
      using errcode = 'P0001',
            hint = 'Changing an expense amount requires rewriting its splits.';
  end if;

  return null;
end;
$$;

create constraint trigger trg_expense_amount_balance
  after update of amount_minor on public.expenses
  deferrable initially deferred
  for each row execute function public.assert_expense_amount_balance();


-- =============================================================================
-- 4. Participants must be household members
-- =============================================================================
-- Without this, a split could reference someone outside the household. That row
-- would then appear in balance calculations for a household the person cannot
-- see — a debt they can neither view nor settle.
create or replace function public.assert_split_member()
returns trigger
language plpgsql
as $$
declare
  v_household_id uuid;
begin
  select household_id into v_household_id
  from public.expenses
  where id = new.expense_id;

  if v_household_id is null then
    return null; -- Parent expense is being removed in this transaction.
  end if;

  if not exists (
    select 1 from public.household_members
    where household_id = v_household_id
      and user_id = new.user_id
  ) then
    raise exception
      'NOT_HOUSEHOLD_MEMBER: user % is not a member of household %',
      new.user_id, v_household_id
      using errcode = 'P0002',
            hint = 'Only current household members can participate in an expense.';
  end if;

  return null;
end;
$$;

-- Deferred as well: an invitation acceptance and an expense creation could
-- legitimately occur in the same transaction, and the membership row may be
-- written after the split row.
create constraint trigger trg_splits_membership
  after insert or update on public.expense_splits
  deferrable initially deferred
  for each row execute function public.assert_split_member();


-- =============================================================================
-- 5. Settlement parties must be household members
-- =============================================================================
create or replace function public.assert_settlement_members()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.household_members
    where household_id = new.household_id and user_id = new.from_user
  ) then
    raise exception 'NOT_HOUSEHOLD_MEMBER: payer % is not in household %',
      new.from_user, new.household_id using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.household_members
    where household_id = new.household_id and user_id = new.to_user
  ) then
    raise exception 'NOT_HOUSEHOLD_MEMBER: recipient % is not in household %',
      new.to_user, new.household_id using errcode = 'P0002';
  end if;

  return null;
end;
$$;

create constraint trigger trg_settlement_membership
  after insert or update on public.settlements
  deferrable initially deferred
  for each row execute function public.assert_settlement_members();


-- =============================================================================
-- 6. Shopping items inherit their list's household
-- =============================================================================
-- `shopping_items.household_id` is denormalised so Realtime can filter on it.
-- Denormalised data that a client is allowed to supply is denormalised data
-- that will eventually be wrong — or forged. Deriving it here means the column
-- is always authoritative regardless of what the caller sent.
create or replace function public.set_shopping_item_household()
returns trigger
language plpgsql
as $$
begin
  select household_id into new.household_id
  from public.shopping_lists
  where id = new.list_id;

  if new.household_id is null then
    raise exception 'INVALID_LIST: shopping list % does not exist', new.list_id
      using errcode = 'P0002';
  end if;

  return new;
end;
$$;

create trigger trg_items_household
  before insert or update of list_id on public.shopping_items
  for each row execute function public.set_shopping_item_household();
