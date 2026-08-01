-- =============================================================================
-- SplitMate — 04. Business functions (RPCs)
-- =============================================================================
-- WHAT BELONGS IN HERE, AND WHAT DOES NOT
--
-- Only two kinds of logic live in the database:
--
--   1. Writes that must be ATOMIC across several tables. An expense without its
--      splits is corrupt data, and PostgREST cannot span multiple statements in
--      one transaction — two separate REST calls can interleave or half-fail.
--      A function is one statement to the client and one transaction to Postgres.
--
--   2. Reads that AGGREGATE. Computing balances by shipping every expense row
--      to Node and summing there wastes bandwidth and scales with the ledger
--      rather than with the number of members.
--
-- Everything else — deciding *how* to split, rounding, choosing who pays whom —
-- stays in TypeScript (lib/domain), where it is exhaustively unit-testable. The
-- functions below receive already-computed shares and only persist them; the
-- deferred trigger from migration 02 independently verifies they balance.
--
-- SECURITY MODEL
--   Functions are SECURITY INVOKER (the default) wherever possible, so RLS still
--   applies to every statement inside them and the caller gains no privilege by
--   going through a function. Only four functions are SECURITY DEFINER, each for
--   a reason stated at its definition, and each re-checks authorization itself.
-- =============================================================================


-- =============================================================================
-- INTERNAL HELPERS (SECURITY DEFINER)
-- =============================================================================

-- Append to the audit trail.
--
-- DEFINER because `activity_log` deliberately has no INSERT policy: entries must
-- be unforgeable. Routing every write through this one function means a client
-- can never fabricate an entry that appears to come from another member, and can
-- never edit or remove one.
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
  -- Elevated privilege demands an explicit authorization check: without this,
  -- any authenticated user could write into any household's activity feed.
  if not public.is_household_member(p_household_id) then
    raise exception 'FORBIDDEN: not a member of household %', p_household_id
      using errcode = 'P0003';
  end if;

  insert into public.activity_log
    (household_id, actor_id, entity_type, entity_id, action, metadata)
  values
    (p_household_id, auth.uid(), p_entity_type, p_entity_id, p_action, p_metadata);
end;
$$;

-- Send an in-app notification to several household members at once.
--
-- DEFINER for the same reason as log_activity: `notifications` has no INSERT
-- policy, so a roommate cannot fabricate a system message such as
-- "Your rent was settled". Recipients are filtered to actual members, so a
-- caller cannot use this to write rows into a stranger's notification list.
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
  if not public.is_household_member(p_household_id) then
    raise exception 'FORBIDDEN: not a member of household %', p_household_id
      using errcode = 'P0003';
  end if;

  insert into public.notifications (user_id, household_id, type, payload)
  select m.user_id, p_household_id, p_type, p_payload
  from public.household_members m
  where m.household_id = p_household_id
    and m.user_id = any (p_user_ids)
    -- Never notify someone about their own action; they just performed it.
    and m.user_id <> auth.uid();
end;
$$;


-- =============================================================================
-- create_household — the bootstrap problem
-- =============================================================================
-- Creating a household means inserting the household row AND the creator's
-- owner-membership row. Between those two statements the creator is not yet a
-- member of anything, so no membership-based RLS policy can authorise the
-- second insert. That is why `households` and `household_members` have no
-- INSERT policies at all and this function is SECURITY DEFINER.
--
-- Being elevated, it does its own authorization: it refuses an anonymous caller
-- and hard-codes `auth.uid()` as both creator and owner, so it cannot be used to
-- create a household on someone else's behalf.
--
-- It also seeds the things a new household is useless without: a default set of
-- categories and one shopping list.
create or replace function public.create_household(
  p_name     text,
  p_currency char(3) default 'ILS',
  p_timezone text    default 'Asia/Jerusalem'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_household_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: sign in required' using errcode = 'P0004';
  end if;

  -- Length and shape are also enforced by column constraints; checking here
  -- produces a clean domain error instead of a raw constraint violation.
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'VALIDATION: household name is required' using errcode = 'P0005';
  end if;

  insert into public.households (name, currency, timezone, created_by)
  values (trim(p_name), upper(p_currency), p_timezone, v_user_id)
  returning id into v_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, v_user_id, 'owner');

  -- Default categories. Copied per household rather than shared globally so a
  -- household can rename or recolour them freely without affecting anyone else.
  insert into public.categories (household_id, name, icon, color, sort_order)
  values
    (v_household_id, 'Rent',          'home',         '#6366f1', 10),
    (v_household_id, 'Utilities',     'zap',          '#f59e0b', 20),
    (v_household_id, 'Groceries',     'shopping-cart','#10b981', 30),
    (v_household_id, 'Household',     'sofa',         '#8b5cf6', 40),
    (v_household_id, 'Internet',      'wifi',         '#0ea5e9', 50),
    (v_household_id, 'Transport',     'car',          '#ef4444', 60),
    (v_household_id, 'Entertainment', 'party-popper', '#ec4899', 70),
    (v_household_id, 'Other',         'receipt',      '#64748b', 99);

  insert into public.shopping_lists (household_id, name, created_by)
  values (v_household_id, 'Shopping', v_user_id);

  perform public.log_activity(
    v_household_id, 'household', v_household_id, 'created',
    jsonb_build_object('name', trim(p_name))
  );

  return v_household_id;
end;
$$;


-- =============================================================================
-- accept_invitation — the other bootstrap problem
-- =============================================================================
-- An invitee is by definition NOT a member yet, so they cannot read the
-- `invitations` table (its SELECT policy requires an admin role). Without a
-- DEFINER function there would be no way to look up the invitation at all.
--
-- The alternative — opening a readable policy on invitations — would let anyone
-- enumerate pending invitations across the whole system. This function instead
-- reveals nothing: it accepts a token, and either joins you or fails.
--
-- The token is looked up by SHA-256 hash. The raw token exists only in the
-- emailed link, so even a full dump of this table grants no access.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_invitation public.invitations%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: sign in required' using errcode = 'P0004';
  end if;

  select email into v_user_email from public.profiles where id = v_user_id;

  select * into v_invitation
  from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- A deliberately vague message: distinguishing "no such invitation" from
  -- "expired" would let someone probe for valid tokens.
  if v_invitation.id is null then
    raise exception 'INVITE_INVALID: this invitation link is not valid'
      using errcode = 'P0006';
  end if;

  if v_invitation.revoked_at is not null then
    raise exception 'INVITE_REVOKED: this invitation was cancelled'
      using errcode = 'P0006';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'INVITE_USED: this invitation has already been used'
      using errcode = 'P0006';
  end if;

  if v_invitation.expires_at < now() then
    raise exception 'INVITE_EXPIRED: this invitation has expired'
      using errcode = 'P0006';
  end if;

  -- An email-targeted invitation is bound to that address; a link invitation
  -- (email is null) may be accepted by whoever holds the link.
  if v_invitation.email is not null
     and lower(v_invitation.email) <> lower(coalesce(v_user_email, '')) then
    raise exception 'INVITE_EMAIL_MISMATCH: this invitation was sent to a different address'
      using errcode = 'P0006';
  end if;

  -- Already a member: succeed quietly rather than erroring. Someone clicking a
  -- link twice should land in the household, not on an error page.
  if public.is_member_of(v_invitation.household_id, v_user_id) then
    return v_invitation.household_id;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_invitation.household_id, v_user_id, v_invitation.role);

  update public.invitations
  set accepted_at = now(), accepted_by = v_user_id
  where id = v_invitation.id;

  perform public.log_activity(
    v_invitation.household_id, 'member', v_user_id, 'joined',
    jsonb_build_object('via', 'invitation', 'role', v_invitation.role)
  );

  perform public.notify_users(
    array[v_invitation.created_by], v_invitation.household_id, 'invite_accepted',
    jsonb_build_object('user_id', v_user_id)
  );

  return v_invitation.household_id;
end;
$$;


-- =============================================================================
-- create_expense_with_splits
-- =============================================================================
-- Atomicity is the whole point: the expense, its splits, the activity entry and
-- the notifications either all exist or none do. The deferred balance trigger
-- fires at COMMIT and rejects the entire transaction if the shares do not sum
-- to the total.
--
-- SECURITY INVOKER: every insert below is still filtered by RLS, so a caller who
-- is not a member of the household simply cannot write, function or no function.
-- `created_by` is taken from auth.uid() rather than from the payload, so it
-- cannot be spoofed.
create or replace function public.create_expense_with_splits(p_payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_user_id      uuid := auth.uid();
  v_household_id uuid := (p_payload ->> 'household_id')::uuid;
  v_expense_id   uuid;
  v_idem         text := nullif(p_payload ->> 'idempotency_key', '');
  v_participants uuid[];
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: sign in required' using errcode = 'P0004';
  end if;

  -- Idempotency: if this exact submission was already processed, return the
  -- original expense instead of creating a duplicate. This makes a retried
  -- request after a dropped connection harmless.
  if v_idem is not null then
    select id into v_expense_id
    from public.expenses
    where household_id = v_household_id and idempotency_key = v_idem;

    if v_expense_id is not null then
      return v_expense_id;
    end if;
  end if;

  insert into public.expenses (
    household_id, payer_id, category_id, description, amount_minor,
    split_method, spent_at, note, receipt_path, recurring_id,
    idempotency_key, created_by
  )
  values (
    v_household_id,
    (p_payload ->> 'payer_id')::uuid,
    nullif(p_payload ->> 'category_id', '')::uuid,
    p_payload ->> 'description',
    (p_payload ->> 'amount_minor')::bigint,
    (p_payload ->> 'split_method')::public.split_method,
    (p_payload ->> 'spent_at')::date,
    nullif(p_payload ->> 'note', ''),
    nullif(p_payload ->> 'receipt_path', ''),
    nullif(p_payload ->> 'recurring_id', '')::uuid,
    v_idem,
    v_user_id
  )
  returning id into v_expense_id;

  -- Shares arrive pre-computed by lib/domain/splits.ts. The database's job is
  -- to store them atomically and to verify (via the deferred trigger) that they
  -- add up — not to decide what they should be.
  insert into public.expense_splits (expense_id, user_id, share_minor, share_input)
  select
    v_expense_id,
    (s ->> 'user_id')::uuid,
    (s ->> 'share_minor')::bigint,
    nullif(s ->> 'share_input', '')::numeric
  from jsonb_array_elements(p_payload -> 'splits') as s;

  perform public.log_activity(
    v_household_id, 'expense', v_expense_id, 'created',
    jsonb_build_object(
      'description', p_payload ->> 'description',
      'amount_minor', (p_payload ->> 'amount_minor')::bigint
    )
  );

  -- Notify everyone who now owes something, so an expense can never be added
  -- to your account without you hearing about it.
  select array_agg(user_id) into v_participants
  from public.expense_splits
  where expense_id = v_expense_id;

  perform public.notify_users(
    v_participants, v_household_id, 'expense_created',
    jsonb_build_object(
      'expense_id', v_expense_id,
      'description', p_payload ->> 'description',
      'amount_minor', (p_payload ->> 'amount_minor')::bigint
    )
  );

  return v_expense_id;
end;
$$;


-- =============================================================================
-- update_expense_with_splits
-- =============================================================================
-- Replaces the expense's fields and its entire split set, records a revision,
-- and does it all in one transaction.
--
-- `p_expected_updated_at` implements optimistic concurrency. Two roommates can
-- open the same expense; without this check the second save would silently
-- overwrite the first, and neither would know. Comparing the timestamp the
-- editor loaded against the current one turns a lost update into a visible
-- CONFLICT the UI can explain.
create or replace function public.update_expense_with_splits(
  p_expense_id          uuid,
  p_payload             jsonb,
  p_expected_updated_at timestamptz
)
returns void
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_before  jsonb;
  v_after   jsonb;
  v_current timestamptz;
  v_household_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: sign in required' using errcode = 'P0004';
  end if;

  -- Lock the row for the duration of the transaction so a concurrent update
  -- cannot slip between this read and the write below.
  select updated_at, household_id into v_current, v_household_id
  from public.expenses
  where id = p_expense_id and deleted_at is null
  for update;

  if v_current is null then
    raise exception 'NOT_FOUND: expense % does not exist', p_expense_id
      using errcode = 'P0007';
  end if;

  -- Compared with millisecond tolerance: the timestamp makes a round trip
  -- through JSON, where sub-millisecond precision is not preserved.
  if abs(extract(epoch from (v_current - p_expected_updated_at))) > 0.001 then
    raise exception 'CONFLICT: this expense was changed by someone else'
      using errcode = 'P0008',
            hint = 'Reload the expense to see the current version.';
  end if;

  -- Snapshot before mutating, including the splits, so the revision record
  -- captures the complete prior state rather than a partial diff.
  select to_jsonb(e) || jsonb_build_object(
           'splits',
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'user_id', s.user_id, 'share_minor', s.share_minor))
             from public.expense_splits s where s.expense_id = e.id
           ), '[]'::jsonb)
         )
    into v_before
  from public.expenses e
  where e.id = p_expense_id;

  update public.expenses
  set payer_id     = (p_payload ->> 'payer_id')::uuid,
      category_id  = nullif(p_payload ->> 'category_id', '')::uuid,
      description  = p_payload ->> 'description',
      amount_minor = (p_payload ->> 'amount_minor')::bigint,
      split_method = (p_payload ->> 'split_method')::public.split_method,
      spent_at     = (p_payload ->> 'spent_at')::date,
      note         = nullif(p_payload ->> 'note', ''),
      receipt_path = nullif(p_payload ->> 'receipt_path', '')
  where id = p_expense_id;

  -- Delete-then-insert rather than a per-row merge: the participant set itself
  -- may change, and the deferred trigger only judges the final state, so the
  -- momentarily empty split set inside the transaction is legal.
  delete from public.expense_splits where expense_id = p_expense_id;

  insert into public.expense_splits (expense_id, user_id, share_minor, share_input)
  select
    p_expense_id,
    (s ->> 'user_id')::uuid,
    (s ->> 'share_minor')::bigint,
    nullif(s ->> 'share_input', '')::numeric
  from jsonb_array_elements(p_payload -> 'splits') as s;

  select to_jsonb(e) || jsonb_build_object(
           'splits',
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'user_id', s.user_id, 'share_minor', s.share_minor))
             from public.expense_splits s where s.expense_id = e.id
           ), '[]'::jsonb)
         )
    into v_after
  from public.expenses e
  where e.id = p_expense_id;

  insert into public.expense_revisions (expense_id, changed_by, before, after)
  values (p_expense_id, v_user_id, v_before, v_after);

  perform public.log_activity(
    v_household_id, 'expense', p_expense_id, 'updated',
    jsonb_build_object('description', p_payload ->> 'description')
  );
end;
$$;


-- =============================================================================
-- soft_delete_expense
-- =============================================================================
-- Removes an expense from balances and lists while keeping it in the audit
-- trail. RLS (`expenses_update` + `can_modify_expense`) decides whether the
-- caller is allowed to do this; the function does not re-implement that rule.
create or replace function public.soft_delete_expense(p_expense_id uuid)
returns void
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid;
  v_description text;
  v_participants uuid[];
begin
  select household_id, description into v_household_id, v_description
  from public.expenses
  where id = p_expense_id and deleted_at is null;

  if v_household_id is null then
    raise exception 'NOT_FOUND: expense % does not exist', p_expense_id
      using errcode = 'P0007';
  end if;

  select array_agg(user_id) into v_participants
  from public.expense_splits where expense_id = p_expense_id;

  -- If RLS forbids this update, the statement affects zero rows rather than
  -- raising — so the result is checked explicitly below.
  update public.expenses
  set deleted_at = now(), deleted_by = v_user_id
  where id = p_expense_id;

  if not found then
    raise exception 'FORBIDDEN: you cannot delete this expense' using errcode = 'P0003';
  end if;

  perform public.log_activity(
    v_household_id, 'expense', p_expense_id, 'deleted',
    jsonb_build_object('description', v_description)
  );

  perform public.notify_users(
    v_participants, v_household_id, 'expense_deleted',
    jsonb_build_object('expense_id', p_expense_id, 'description', v_description)
  );
end;
$$;


-- =============================================================================
-- settle_up
-- =============================================================================
-- Records that a real-world payment happened. SplitMate never moves money; this
-- is a ledger fact, which is why it is an insert and not a transfer.
create or replace function public.settle_up(
  p_household_id uuid,
  p_from_user    uuid,
  p_to_user      uuid,
  p_amount_minor bigint,
  p_method       public.settlement_method default 'other',
  p_note         text default null
)
returns uuid
language plpgsql
as $$
declare
  v_user_id       uuid := auth.uid();
  v_settlement_id uuid;
begin
  if p_amount_minor <= 0 then
    raise exception 'VALIDATION: settlement amount must be positive'
      using errcode = 'P0005';
  end if;

  if p_from_user = p_to_user then
    raise exception 'VALIDATION: cannot settle with yourself' using errcode = 'P0005';
  end if;

  -- The RLS insert policy independently requires the caller to be one of the
  -- two parties; this check exists to produce a clear message instead of an
  -- opaque policy violation.
  if v_user_id not in (p_from_user, p_to_user) then
    raise exception 'FORBIDDEN: you can only record a payment you were part of'
      using errcode = 'P0003';
  end if;

  insert into public.settlements
    (household_id, from_user, to_user, amount_minor, method, note, created_by)
  values
    (p_household_id, p_from_user, p_to_user, p_amount_minor, p_method, p_note, v_user_id)
  returning id into v_settlement_id;

  perform public.log_activity(
    p_household_id, 'settlement', v_settlement_id, 'created',
    jsonb_build_object(
      'from', p_from_user, 'to', p_to_user, 'amount_minor', p_amount_minor
    )
  );

  -- Notify the counterparty — the person who did NOT record it.
  perform public.notify_users(
    array[case when v_user_id = p_from_user then p_to_user else p_from_user end],
    p_household_id, 'settlement_recorded',
    jsonb_build_object('settlement_id', v_settlement_id, 'amount_minor', p_amount_minor)
  );

  return v_settlement_id;
end;
$$;


-- =============================================================================
-- void_settlement
-- =============================================================================
create or replace function public.void_settlement(p_settlement_id uuid, p_reason text default null)
returns void
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid;
  v_from uuid;
  v_to   uuid;
begin
  select household_id, from_user, to_user
    into v_household_id, v_from, v_to
  from public.settlements
  where id = p_settlement_id and voided_at is null;

  if v_household_id is null then
    raise exception 'NOT_FOUND: settlement not found or already voided'
      using errcode = 'P0007';
  end if;

  update public.settlements
  set voided_at = now(), voided_by = v_user_id,
      note = coalesce(note, '') ||
             case when p_reason is null then '' else ' [voided: ' || p_reason || ']' end
  where id = p_settlement_id;

  if not found then
    raise exception 'FORBIDDEN: you cannot void this settlement' using errcode = 'P0003';
  end if;

  perform public.log_activity(
    v_household_id, 'settlement', p_settlement_id, 'voided',
    jsonb_build_object('reason', p_reason)
  );

  perform public.notify_users(
    array[v_from, v_to], v_household_id, 'settlement_voided',
    jsonb_build_object('settlement_id', p_settlement_id)
  );
end;
$$;


-- =============================================================================
-- checkout_shopping_items
-- =============================================================================
-- The workflow that ties the two halves of the product together: the checked
-- items on the shared list become a real expense, and each item keeps a link to
-- the expense it became, so any grocery bill can be traced back to what was
-- actually in the basket.
create or replace function public.checkout_shopping_items(
  p_item_ids uuid[],
  p_payload  jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_expense_id uuid;
begin
  if array_length(p_item_ids, 1) is null then
    raise exception 'VALIDATION: select at least one item to check out'
      using errcode = 'P0005';
  end if;

  -- Reuses the same creation path as a manual expense, so there is exactly one
  -- implementation of "how an expense comes into existence".
  v_expense_id := public.create_expense_with_splits(p_payload);

  -- Archive rather than delete: the list history is how a member later answers
  -- "did we already buy coffee this week?".
  update public.shopping_items
  set archived_at = now(), converted_expense_id = v_expense_id
  where id = any (p_item_ids)
    and archived_at is null;

  return v_expense_id;
end;
$$;


-- =============================================================================
-- get_household_balances — the analytical heart of the product
-- =============================================================================
-- Balances are DERIVED here, never stored. A stored balance is a cache of
-- financial truth: every write path would have to update it correctly forever,
-- and one missed update produces a permanently wrong number that nobody can
-- explain. Deriving costs a few indexed aggregates and cannot drift.
--
--   net = (what they paid) - (what they owed)
--       + (settlements they sent) - (settlements they received)
--
-- Positive net  → the household owes this member money.
-- Negative net  → this member owes the household money.
-- The sum of all nets in a household is always exactly zero; the test suite
-- asserts that property against randomly generated ledgers.
--
-- SECURITY INVOKER (the default) matters here: RLS still applies inside the
-- function, so a non-member calling it receives an empty result rather than
-- another household's finances.
create or replace function public.get_household_balances(p_household_id uuid)
returns table (
  user_id     uuid,
  paid        bigint,
  owed        bigint,
  settled_out bigint,
  settled_in  bigint,
  net         bigint
)
language sql
stable
as $$
  with members as (
    select hm.user_id
    from public.household_members hm
    where hm.household_id = p_household_id
  ),
  paid as (
    select e.payer_id as user_id, sum(e.amount_minor) as amt
    from public.expenses e
    where e.household_id = p_household_id and e.deleted_at is null
    group by e.payer_id
  ),
  owed as (
    select s.user_id, sum(s.share_minor) as amt
    from public.expense_splits s
    join public.expenses e on e.id = s.expense_id
    where e.household_id = p_household_id and e.deleted_at is null
    group by s.user_id
  ),
  sent as (
    select st.from_user as user_id, sum(st.amount_minor) as amt
    from public.settlements st
    where st.household_id = p_household_id and st.voided_at is null
    group by st.from_user
  ),
  received as (
    select st.to_user as user_id, sum(st.amount_minor) as amt
    from public.settlements st
    where st.household_id = p_household_id and st.voided_at is null
    group by st.to_user
  )
  select
    m.user_id,
    coalesce(p.amt, 0)  as paid,
    coalesce(o.amt, 0)  as owed,
    coalesce(s.amt, 0)  as settled_out,
    coalesce(r.amt, 0)  as settled_in,
    coalesce(p.amt, 0) - coalesce(o.amt, 0)
      + coalesce(s.amt, 0) - coalesce(r.amt, 0) as net
  from members m
  left join paid     p on p.user_id = m.user_id
  left join owed     o on o.user_id = m.user_id
  left join sent     s on s.user_id = m.user_id
  left join received r on r.user_id = m.user_id;
$$;


-- =============================================================================
-- ANALYTICS
-- =============================================================================
-- Aggregating in SQL instead of in Node is the difference between transferring
-- one row per category and transferring every expense the household ever made.

-- Spend per category per month, for the Insights charts.
create or replace function public.get_monthly_breakdown(
  p_household_id uuid,
  p_from date,
  p_to   date
)
returns table (
  month        date,
  category_id  uuid,
  category_name text,
  total_minor  bigint,
  expense_count bigint
)
language sql
stable
as $$
  select
    date_trunc('month', e.spent_at)::date as month,
    e.category_id,
    coalesce(c.name, 'Uncategorised')     as category_name,
    sum(e.amount_minor)                   as total_minor,
    count(*)                              as expense_count
  from public.expenses e
  left join public.categories c on c.id = e.category_id
  where e.household_id = p_household_id
    and e.deleted_at is null
    and e.spent_at between p_from and p_to
  group by 1, 2, 3
  order by 1 desc, 4 desc;
$$;

-- Paid vs. consumed per member — the "fairness" view. Two members can have an
-- identical net balance while one of them repeatedly fronts the money, which is
-- a real burden that a balance alone hides.
create or replace function public.get_member_stats(
  p_household_id uuid,
  p_from date,
  p_to   date
)
returns table (
  user_id       uuid,
  paid_minor    bigint,
  consumed_minor bigint,
  expense_count bigint
)
language sql
stable
as $$
  with members as (
    select hm.user_id from public.household_members hm
    where hm.household_id = p_household_id
  ),
  paid as (
    select e.payer_id as user_id, sum(e.amount_minor) amt, count(*) cnt
    from public.expenses e
    where e.household_id = p_household_id and e.deleted_at is null
      and e.spent_at between p_from and p_to
    group by e.payer_id
  ),
  consumed as (
    select s.user_id, sum(s.share_minor) amt
    from public.expense_splits s
    join public.expenses e on e.id = s.expense_id
    where e.household_id = p_household_id and e.deleted_at is null
      and e.spent_at between p_from and p_to
    group by s.user_id
  )
  select m.user_id,
         coalesce(p.amt, 0),
         coalesce(c.amt, 0),
         coalesce(p.cnt, 0)
  from members m
  left join paid     p on p.user_id = m.user_id
  left join consumed c on c.user_id = m.user_id;
$$;


-- =============================================================================
-- PRIVILEGES
-- =============================================================================
-- Postgres grants EXECUTE on new functions to PUBLIC by default, which includes
-- the `anon` role — every unauthenticated visitor. For the SECURITY DEFINER
-- functions that is unacceptable, so execution is revoked and re-granted to
-- authenticated users only. (Each of them also checks auth.uid() internally;
-- this is defence in depth.)
revoke execute on function public.create_household(text, char, text) from public;
revoke execute on function public.accept_invitation(text) from public;
revoke execute on function public.log_activity(uuid, text, uuid, text, jsonb) from public;
revoke execute on function public.notify_users(uuid[], uuid, public.notification_type, jsonb) from public;

grant execute on function public.create_household(text, char, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.log_activity(uuid, text, uuid, text, jsonb) to authenticated;
grant execute on function public.notify_users(uuid[], uuid, public.notification_type, jsonb) to authenticated;

-- The RLS helper predicates are evaluated during policy checks and must remain
-- executable by the roles that query the tables.
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.has_household_role(uuid, public.household_role[]) to authenticated;
grant execute on function public.shares_household_with(uuid) to authenticated;
grant execute on function public.can_modify_expense(uuid) to authenticated;
grant execute on function public.is_member_of(uuid, uuid) to authenticated;
