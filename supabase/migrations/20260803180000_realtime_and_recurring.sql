-- =============================================================================
-- Realtime publication, and the machinery that turns a recurring rule into a
-- real expense.
-- =============================================================================
-- Two gaps the earlier migrations left, both of which only become visible when
-- the application layer arrives:
--
--   1. The schema was designed for Realtime — `shopping_items` carries a
--      denormalised `household_id` precisely so a subscription can filter on it
--      — but no table was ever added to the `supabase_realtime` publication.
--      Postgres was therefore not emitting the changes anyone could subscribe
--      to. Enabling replication is a property of the publication, not of the
--      table definition, so nothing in the schema hinted that it was missing.
--
--   2. `recurring_expenses` records what should happen and when, and
--      `expenses.recurring_id` records that it did, but nothing connected the
--      two. This adds that step.


-- =============================================================================
-- Realtime
-- =============================================================================
-- `add table` errors if the table is already published, and a migration has to
-- be safe to replay, so each is guarded.
--
-- Only two tables are published, deliberately. Every published table streams
-- every committed change to the WAL reader whether or not a client is listening,
-- so publishing the whole schema would put the expense ledger on the wire
-- continuously to serve a feature nobody subscribes to. Shopping items need it
-- because two people standing in the same supermarket must not buy the same
-- milk; notifications need it because a badge that only updates on navigation is
-- not a notification.
--
-- REPLICA IDENTITY FULL is required for DELETE events to carry more than the
-- primary key. Without it a client receiving a delete knows only the id, which
-- is enough to remove a row from a list but not enough to filter that event by
-- `household_id` — so every client in every household would receive every
-- delete and have to trust its own cache to decide whether it cared.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_items'
  ) then
    alter publication supabase_realtime add table public.shopping_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

alter table public.shopping_items replica identity full;
alter table public.notifications replica identity full;


-- =============================================================================
-- advance_recurrence
-- =============================================================================
-- Given the date a rule last fired, returns the next date it should fire.
--
-- The hard case is monthly on the 31st. February has no 31st, and neither do
-- April, June, September or November. Two behaviours are defensible: skip the
-- month, or fall back to its last day. Falling back is the right answer for the
-- thing this models — rent due "on the 31st" is still due in February — and
-- skipping would silently drop a month's rent from the ledger, which is the
-- worse failure by a wide margin.
--
-- Note that the fallback does not compound: the day is always recomputed from
-- `p_day`, never from the clamped previous result. A rule set to the 31st that
-- fires on 28 February fires on 31 March, not on 28 March.

create or replace function public.advance_recurrence(
  p_from date,
  p_frequency public.recurrence_freq,
  p_day int
)
returns date
language plpgsql
immutable
as $$
declare
  v_target   date;
  v_month    date;
  v_last_day int;
begin
  if p_frequency = 'weekly' then
    -- `day_of_period` is an ISO weekday (1 = Monday) for weekly rules. Advancing
    -- by exactly seven days preserves it without any calendar arithmetic.
    return p_from + 7;
  end if;

  if p_frequency = 'monthly' then
    v_month := date_trunc('month', p_from)::date + interval '1 month';
  else
    v_month := date_trunc('month', p_from)::date + interval '1 year';
  end if;

  v_last_day := extract(day from (v_month + interval '1 month' - interval '1 day'))::int;
  v_target := v_month + (least(p_day, v_last_day) - 1);

  return v_target;
end;
$$;

comment on function public.advance_recurrence(date, public.recurrence_freq, int) is
  'Next fire date for a recurring rule. Clamps to month length rather than skipping short months.';


-- =============================================================================
-- generate_recurring_expense
-- =============================================================================
-- Materialises one due rule into one expense, and moves the rule's schedule on.
--
-- WHY THIS TAKES PRE-COMPUTED SPLITS
-- The same reason `create_expense_with_splits` does. Largest-remainder
-- allocation lives in lib/domain/splits.ts and is the single definition of how
-- money is divided in this system; reimplementing it in PL/pgSQL would create a
-- second definition, and the two would diverge the first time either changed.
-- The caller computes, the database stores and verifies — the deferred
-- constraint trigger still refuses any split set that does not sum to the total.
--
-- WHY SECURITY DEFINER, AND WHY IT IS NOT EXPOSED TO USERS
-- A cron run has no logged-in user, so `auth.uid()` is null and every RLS policy
-- correctly refuses it. This runs as the definer instead, and is then revoked
-- from `authenticated` and `anon`: the only caller that can reach it is one
-- holding the service-role key, which is the scheduled job. Leaving it callable
-- by end users would hand any member a way to write an expense attributed to
-- somebody else without passing the policies that normally prevent it.
--
-- DOUBLE-RUN SAFETY
-- Cron delivers at-least-once, and a job that times out halfway may be retried.
-- Two independent guards make that harmless: the `for update` lock plus the
-- re-check of `next_run_at` inside the transaction serialises concurrent runs,
-- and the idempotency key derived from the rule and its due date means a retry
-- resolves to the expense that already exists.

create or replace function public.generate_recurring_expense(
  p_rule_id uuid,
  p_splits jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule        public.recurring_expenses%rowtype;
  v_expense_id  uuid;
  v_due_on      date;
  v_participants uuid[];
begin
  -- `for update` holds the rule row for the rest of the transaction, so a second
  -- concurrent run blocks here and then finds the schedule already advanced.
  select * into v_rule
  from public.recurring_expenses
  where id = p_rule_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: no such recurring rule' using errcode = 'P0002';
  end if;

  if not v_rule.is_active then
    raise exception 'BUSINESS_RULE: rule is paused' using errcode = 'P0003';
  end if;

  if v_rule.next_run_at > current_date then
    raise exception 'BUSINESS_RULE: rule is not due yet' using errcode = 'P0003';
  end if;

  v_due_on := v_rule.next_run_at;

  -- The expense is dated the day the rule was DUE, not the day the job happened
  -- to run. A cron that is late, or that retries the next morning, must not move
  -- rent into the following month.
  insert into public.expenses (
    household_id, payer_id, category_id, description, amount_minor,
    split_method, spent_at, note, recurring_id, idempotency_key, created_by
  )
  values (
    v_rule.household_id,
    v_rule.payer_id,
    v_rule.category_id,
    v_rule.description,
    v_rule.amount_minor,
    v_rule.split_method,
    v_due_on,
    null,
    v_rule.id,
    'recurring:' || v_rule.id || ':' || v_due_on,
    v_rule.created_by
  )
  -- The predicate is not optional. `idx_expenses_idempotency` is a PARTIAL
  -- unique index, and Postgres only matches an inferred conflict target to a
  -- partial index when the statement repeats its predicate — without this the
  -- insert raises "no unique or exclusion constraint matching the ON CONFLICT
  -- specification" rather than doing nothing.
  on conflict (household_id, idempotency_key) where idempotency_key is not null
  do nothing
  returning id into v_expense_id;

  -- A conflict means a previous run already created this expense. The schedule
  -- still has to move on, or the rule stays due forever and every subsequent run
  -- repeats this same no-op.
  if v_expense_id is null then
    select id into v_expense_id
    from public.expenses
    where household_id = v_rule.household_id
      and idempotency_key = 'recurring:' || v_rule.id || ':' || v_due_on;
  else
    insert into public.expense_splits (expense_id, user_id, share_minor, share_input)
    select
      v_expense_id,
      (s ->> 'user_id')::uuid,
      (s ->> 'share_minor')::bigint,
      nullif(s ->> 'share_input', '')::numeric
    from jsonb_array_elements(p_splits) as s;

    perform public.log_activity(
      v_rule.household_id, 'expense', v_expense_id, 'created',
      jsonb_build_object(
        'description', v_rule.description,
        'amount_minor', v_rule.amount_minor,
        'recurring', true
      )
    );

    select array_agg(user_id) into v_participants
    from public.expense_splits
    where expense_id = v_expense_id;

    -- `notify_users` skips `auth.uid()`, which is null here, so everyone on the
    -- expense is told — correct for an expense nobody pressed a button to create.
    perform public.notify_users(
      v_participants, v_rule.household_id, 'recurring_generated',
      jsonb_build_object(
        'expense_id', v_expense_id,
        'description', v_rule.description,
        'amount_minor', v_rule.amount_minor
      )
    );
  end if;

  update public.recurring_expenses
  set last_run_at = v_due_on,
      next_run_at = public.advance_recurrence(v_due_on, v_rule.frequency, v_rule.day_of_period)
  where id = v_rule.id;

  return v_expense_id;
end;
$$;

comment on function public.generate_recurring_expense(uuid, jsonb) is
  'Turns one due recurring rule into an expense and advances its schedule. Service role only.';

-- Callable by the scheduled job and by nobody else.
revoke all on function public.generate_recurring_expense(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.generate_recurring_expense(uuid, jsonb) to service_role;

grant execute on function public.advance_recurrence(date, public.recurrence_freq, int) to authenticated, service_role;
