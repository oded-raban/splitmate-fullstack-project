-- =============================================================================
-- Hardening: preview_invitation no longer echoes an email the caller cannot
-- already prove they own.
-- =============================================================================
-- Phase 6's RLS integration suite (tests/integration/invitations.test.ts) tried
-- to confirm that an 'email_mismatch' preview does not reveal the address the
-- invitation was actually sent to — and found that the original implementation
-- returned `v_invitation.email` unconditionally, regardless of status. Holding
-- a raw token is a low bar (it survives being pasted into any chat the real
-- recipient is in), so a forwarded or accidentally-shared link let a stranger
-- learn the intended recipient's email address purely by opening it while
-- signed in as anyone else.
--
-- The fix: the email is only echoed back once the caller has demonstrated they
-- are either the intended recipient (a matching email, i.e. status 'valid' or
-- 'already_member') or someone entitled to manage the invitation regardless of
-- who it names (an owner/admin of the household, who could already see it via
-- `invitations_select`). Every other status returns null for this field.
create or replace function public.preview_invitation(p_token text)
returns table (
  status         text,
  household_id   uuid,
  household_name text,
  invited_role   public.household_role,
  inviter_name   text,
  invited_email  text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_invitation public.invitations%rowtype;
  v_household  public.households%rowtype;
  v_inviter    text;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: sign in required' using errcode = 'P0004';
  end if;

  select email into v_user_email from public.profiles where id = v_user_id;

  select * into v_invitation
  from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if v_invitation.id is null then
    return query select 'invalid'::text, null::uuid, null::text,
                        null::public.household_role, null::text, null::text;
    return;
  end if;

  select * into v_household
  from public.households
  where id = v_invitation.household_id;

  select coalesce(display_name, email) into v_inviter
  from public.profiles
  where id = v_invitation.created_by;

  status := case
    when v_invitation.revoked_at is not null then 'revoked'
    when v_invitation.accepted_at is not null then 'used'
    when v_invitation.expires_at < now() then 'expired'
    when v_invitation.email is not null
         and lower(v_invitation.email) <> lower(coalesce(v_user_email, ''))
      then 'email_mismatch'
    when public.is_member_of(v_invitation.household_id, v_user_id) then 'already_member'
    else 'valid'
  end;

  return query select
    status,
    v_invitation.household_id,
    v_household.name,
    v_invitation.role,
    v_inviter,
    -- Redacted unless the caller is the named recipient or already entitled to
    -- see it through the invitations table's own SELECT policy.
    case
      when v_invitation.email is null then null
      when status in ('valid', 'already_member') then v_invitation.email
      when public.has_household_role(
             v_invitation.household_id, array['owner', 'admin']::public.household_role[]
           ) then v_invitation.email
      else null
    end;
end;
$$;

comment on function public.preview_invitation(text) is
  'Describes an invitation to its holder without granting any read on invitations or households. Redacts the invited email unless the caller is its owner or a household admin.';
