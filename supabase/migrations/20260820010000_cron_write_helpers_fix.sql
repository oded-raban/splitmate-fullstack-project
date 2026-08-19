-- =============================================================================
-- Hardening: log_activity and notify_users must not reject the scheduled job.
-- =============================================================================
-- Phase 6's integration suite (tests/integration/recurring.test.ts) exercised
-- `generate_recurring_expense` the same way the cron route actually calls it —
-- with the service-role key, which carries no JWT at all — and found that the
-- recurring-expense feature was silently broken end to end.
--
-- WHAT WAS WRONG
-- `log_activity` and `notify_users` both gate on `is_household_member(id)`,
-- which reduces to "does a household_members row exist for auth.uid()". Under
-- the service-role key there IS no auth.uid() — RLS does not even apply to
-- that role, so this check was the only gate left, and a null auth.uid() can
-- never match anyone's membership. Every call from `generate_recurring_expense`
-- therefore raised FORBIDDEN, which aborted the whole transaction: no expense,
-- no activity entry, no notification. The cron job has been failing on every
-- due rule since it was introduced.
--
-- THE FIX
-- Treat a null auth.uid() as "trusted backend caller" and skip the membership
-- check in that case. This is safe because these functions are unreachable by
-- an ordinary client with a null auth.uid() in the first place: PostgREST
-- always attaches a JWT for the `anon` and `authenticated` roles, so the only
-- way to call a DEFINER function with auth.uid() null is to already hold the
-- service-role key — a caller RLS was never protecting against, because it
-- bypasses RLS entirely regardless of what these two functions do.
-- =============================================================================

create or replace function public.log_activity(
  p_household_id uuid,
  p_entity_type  text,
  p_entity_id    uuid,
  p_action       text,
  p_metadata     jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_household_member(p_household_id) then
    raise exception 'FORBIDDEN: not a member of household %', p_household_id
      using errcode = 'P0003';
  end if;

  insert into public.activity_log
    (household_id, actor_id, entity_type, entity_id, action, metadata)
  values
    (p_household_id, auth.uid(), p_entity_type, p_entity_id, p_action, p_metadata);
end;
$$;

create or replace function public.notify_users(
  p_user_ids     uuid[],
  p_household_id uuid,
  p_type         public.notification_type,
  p_payload      jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_household_member(p_household_id) then
    raise exception 'FORBIDDEN: not a member of household %', p_household_id
      using errcode = 'P0003';
  end if;

  insert into public.notifications (user_id, household_id, type, payload)
  select m.user_id, p_household_id, p_type, p_payload
  from public.household_members m
  where m.household_id = p_household_id
    and m.user_id = any (p_user_ids)
    -- Never notify someone about their own action. `auth.uid()` is null for
    -- the cron job, and no member's id is ever null, so this simply does not
    -- exclude anyone in that case — which is correct, since nobody "performed"
    -- a scheduled action themselves.
    and m.user_id is distinct from auth.uid();
end;
$$;

comment on function public.log_activity(uuid, text, uuid, text, jsonb) is
  'Unforgeable audit trail entry. Membership is checked only for authenticated callers; a null auth.uid() means the service-role key, which already bypasses RLS.';

comment on function public.notify_users(uuid[], uuid, public.notification_type, jsonb) is
  'Unforgeable notification fan-out. Membership is checked only for authenticated callers; a null auth.uid() means the service-role key, which already bypasses RLS.';
