-- =============================================================================
-- Migration: invitation preview + atomic ownership transfer
-- =============================================================================
-- Two gaps that only became visible once the household flows were built against
-- the schema.
-- =============================================================================


-- =============================================================================
-- preview_invitation — show what is behind a link before committing to it
-- =============================================================================
-- Asking someone to click "Join" with no idea whose household they are joining
-- is a poor experience and a phishing vector: an invitation link that reveals
-- nothing until after it is accepted trains people to accept blindly.
--
-- The invitee cannot read `invitations` (its SELECT policy requires an admin
-- role in the target household) nor `households` (its SELECT policy requires
-- membership), so a DEFINER function is the only way to show a preview.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- It does not enumerate. The only key is the raw token — 32 bytes of CSPRNG
-- output, never stored, matched here by SHA-256 hash. Guessing one is not a
-- realistic attack, and holding one already entitles the holder to join.
--
-- It returns a status rather than raising, because every one of these states
-- needs its own sentence on screen ("this invitation has already been used" is
-- a different situation from "this link is not valid") and an exception would
-- collapse them all into one error page.
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

  -- Nothing is echoed back for an unknown token: no household, no role, no hint
  -- that a similar token might exist.
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

  -- The household name is shown for every non-'invalid' status, including the
  -- expired and used ones: someone holding a real token that has gone stale
  -- needs to know which household to ask for a fresh link.
  return query select status, v_invitation.household_id, v_household.name,
                      v_invitation.role, v_inviter, v_invitation.email;
end;
$$;

revoke execute on function public.preview_invitation(text) from public;
grant execute on function public.preview_invitation(text) to authenticated;

comment on function public.preview_invitation(text) is
  'Describes an invitation to its holder without granting any read on invitations or households.';


-- =============================================================================
-- transfer_ownership — the one role change that cannot be a single UPDATE
-- =============================================================================
-- `idx_household_single_owner` is a partial unique index permitting exactly one
-- owner per household. Promoting a member to owner therefore requires demoting
-- the current owner in the same statement-visible moment: promote-then-demote
-- violates the index, and demote-then-promote leaves the household ownerless if
-- the second statement fails.
--
-- Both updates run inside this function's implicit transaction, and the
-- constraint is checked at statement boundaries — so the demotion is already
-- visible when the promotion is checked, and either both land or neither does.
--
-- It is SECURITY DEFINER because the RLS policy on household_members restricts
-- UPDATE to the owner, and the outgoing owner is demoting themselves as part of
-- the same call. The authorisation check below is therefore explicit, and is the
-- real gate: only the household's current owner may call this.
create or replace function public.transfer_ownership(
  p_household_id uuid,
  p_new_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: sign in required' using errcode = 'P0004';
  end if;

  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id
      and user_id = v_user_id
      and role = 'owner'
  ) then
    raise exception 'FORBIDDEN: only the owner can transfer ownership'
      using errcode = 'P0007';
  end if;

  if p_new_owner_id = v_user_id then
    raise exception 'VALIDATION: you already own this household'
      using errcode = 'P0005';
  end if;

  if not public.is_member_of(p_household_id, p_new_owner_id) then
    raise exception 'VALIDATION: that person is not a member of this household'
      using errcode = 'P0005';
  end if;

  update public.household_members
  set role = 'admin'
  where household_id = p_household_id and user_id = v_user_id;

  update public.household_members
  set role = 'owner'
  where household_id = p_household_id and user_id = p_new_owner_id;

  perform public.log_activity(
    p_household_id, 'member', p_new_owner_id, 'ownership_transferred',
    jsonb_build_object('from', v_user_id)
  );

  perform public.notify_users(
    array[p_new_owner_id], p_household_id, 'member_joined',
    jsonb_build_object('event', 'ownership_transferred', 'from', v_user_id)
  );
end;
$$;

revoke execute on function public.transfer_ownership(uuid, uuid) from public;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

comment on function public.transfer_ownership(uuid, uuid) is
  'Atomically moves the single owner role. Callable only by the current owner.';
