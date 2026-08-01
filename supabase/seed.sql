-- =============================================================================
-- SplitMate — local development seed
-- =============================================================================
-- Runs automatically on `npm run db:reset`. LOCAL DEVELOPMENT ONLY — it inserts
-- directly into auth.users, which is a supported thing to do against a local
-- Supabase instance but must never be pointed at production.
--
-- Why seed at all? Because the product is fundamentally multi-user: a household
-- with one member cannot demonstrate a split, a balance, or a settlement. Being
-- able to sign in as three different roommates in three browser profiles turns
-- a five-minute manual setup into a one-command reset, and it gives the
-- integration tests a known starting state.
--
-- Accounts created (password for all three: `password123`)
--   maya@example.com     — owner
--   yonatan@example.com  — admin
--   noa@example.com      — member
--
-- The numbers below are chosen to exercise the interesting cases: an amount
-- that divides evenly, one that does NOT (₪287.50 across three people leaves a
-- one-agora remainder), a percentage split, and a partial settlement.
-- =============================================================================

-- Fixed UUIDs so tests and manual checks can reference known rows.
-- ---------------------------------------------------------------------------
-- Users. Inserting into auth.users fires handle_new_user(), which creates the
-- matching public.profiles row — so this also exercises that trigger on every
-- reset. `full_name` in raw_user_meta_data is what the trigger reads for the
-- display name.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'maya@example.com',
    crypt('password123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Maya Cohen"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'yonatan@example.com',
    crypt('password123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Yonatan Levi"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'noa@example.com',
    crypt('password123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Noa Friedman"}'::jsonb
  )
on conflict (id) do nothing;

-- Identities are what Supabase Auth matches an email/password login against.
-- Without a row here the account exists but cannot sign in.
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at,
  created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email in ('maya@example.com', 'yonatan@example.com', 'noa@example.com')
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- Household
-- ---------------------------------------------------------------------------
-- Inserted directly rather than via create_household(), because that function
-- derives the owner from auth.uid() and there is no authenticated session here.
insert into public.households (id, name, currency, timezone, created_by)
values (
  'b0000000-0000-4000-8000-000000000001',
  'Dizengoff 42', 'ILS', 'Asia/Jerusalem',
  'a0000000-0000-4000-8000-000000000001'
)
on conflict (id) do nothing;

insert into public.household_members (household_id, user_id, role)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'admin'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'member')
on conflict do nothing;

insert into public.categories (id, household_id, name, icon, color, sort_order)
values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Rent',          'home',          '#6366f1', 10),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Utilities',     'zap',           '#f59e0b', 20),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Groceries',     'shopping-cart', '#10b981', 30),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'Household',     'sofa',          '#8b5cf6', 40),
  ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'Internet',      'wifi',          '#0ea5e9', 50),
  ('c0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'Transport',     'car',           '#ef4444', 60),
  ('c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001', 'Entertainment', 'party-popper',  '#ec4899', 70),
  ('c0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000001', 'Other',         'receipt',       '#64748b', 99)
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
-- Every set of splits below sums EXACTLY to its expense total. It has to: the
-- deferred trigger from migration 02 aborts this whole seed otherwise. That
-- makes the seed itself a smoke test of the integrity constraint.

-- 1. Rent — ₪4,500.00 paid by Maya, split evenly and divisibly (3 × ₪1,500.00).
insert into public.expenses
  (id, household_id, payer_id, category_id, description, amount_minor,
   split_method, spent_at, created_by)
values (
  'd0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'August rent', 450000, 'equal', current_date - 20,
  'a0000000-0000-4000-8000-000000000001'
) on conflict (id) do nothing;

insert into public.expense_splits (expense_id, user_id, share_minor) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 150000),
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 150000),
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 150000)
on conflict do nothing;

-- 2. Groceries — ₪287.50 paid by Yonatan. 28750 / 3 = 9583.33..., so the shares
--    are 9583 each with ONE agora left over. The largest-remainder rule assigns
--    it to a single participant (here Maya), and the total is exact:
--    9584 + 9583 + 9583 = 28750. This row exists specifically to demonstrate
--    that the remainder is never silently dropped or duplicated.
insert into public.expenses
  (id, household_id, payer_id, category_id, description, amount_minor,
   split_method, spent_at, created_by)
values (
  'd0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000003',
  'Weekly shop at Shufersal', 28750, 'equal', current_date - 6,
  'a0000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;

insert into public.expense_splits (expense_id, user_id, share_minor) values
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 9584),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 9583),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 9583)
on conflict do nothing;

-- 3. Internet — ₪129.90 paid by Noa, divides evenly (3 × ₪43.30).
insert into public.expenses
  (id, household_id, payer_id, category_id, description, amount_minor,
   split_method, spent_at, created_by)
values (
  'd0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000005',
  'Internet — August', 12990, 'equal', current_date - 12,
  'a0000000-0000-4000-8000-000000000003'
) on conflict (id) do nothing;

insert into public.expense_splits (expense_id, user_id, share_minor) values
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 4330),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 4330),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', 4330)
on conflict do nothing;

-- 4. Electricity — ₪340.00 paid by Maya, split by PERCENTAGE (40/30/30) because
--    Maya works from home. share_input records what was typed so the edit form
--    can reopen showing "40", not "13600".
insert into public.expenses
  (id, household_id, payer_id, category_id, description, amount_minor,
   split_method, spent_at, note, created_by)
values (
  'd0000000-0000-4000-8000-000000000004',
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',
  'Electricity (Jun–Jul)', 34000, 'percentage', current_date - 3,
  'Maya works from home, so a larger share by agreement.',
  'a0000000-0000-4000-8000-000000000001'
) on conflict (id) do nothing;

insert into public.expense_splits (expense_id, user_id, share_minor, share_input) values
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 13600, 40),
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 10200, 30),
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', 10200, 30)
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- A partial settlement
-- ---------------------------------------------------------------------------
-- Yonatan has already transferred ₪100 towards what he owes. Partial payments
-- are legal, and this row makes sure the balance view is exercised with a
-- non-zero settlement rather than only with expenses.
insert into public.settlements
  (id, household_id, from_user, to_user, amount_minor, method, note, created_by)
values (
  'e0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001',
  10000, 'bit', 'Partial payment towards rent',
  'a0000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- Shopping list
-- ---------------------------------------------------------------------------
insert into public.shopping_lists (id, household_id, name, created_by)
values (
  'f0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001', 'Shopping',
  'a0000000-0000-4000-8000-000000000001'
) on conflict (id) do nothing;

-- A mix of unchecked and checked items, so the checkout-to-expense flow has
-- something to convert immediately after a reset.
insert into public.shopping_items
  (list_id, household_id, name, quantity, estimated_minor, added_by, checked_by, checked_at, position)
values
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'Milk', '2', 1200, 'a0000000-0000-4000-8000-000000000001', null, null, 1),
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'Coffee beans', '1 kg', 5500, 'a0000000-0000-4000-8000-000000000002', null, null, 2),
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'Dish soap', null, 1490, 'a0000000-0000-4000-8000-000000000003', null, null, 3),
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'Bread', '2 loaves', 1800, 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', now(), 4),
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'Eggs', '12', 2400, 'a0000000-0000-4000-8000-000000000003',
   'a0000000-0000-4000-8000-000000000002', now(), 5);


-- ---------------------------------------------------------------------------
-- A recurring rule
-- ---------------------------------------------------------------------------
-- Rent on the 1st of each month, split evenly. next_run_at is set to the 1st of
-- next month so the scheduled job has something realistic to pick up.
insert into public.recurring_expenses
  (household_id, description, amount_minor, category_id, payer_id, split_method,
   split_config, frequency, day_of_period, next_run_at, created_by)
values (
  'b0000000-0000-4000-8000-000000000001',
  'Monthly rent', 450000,
  'c0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'equal',
  '[{"user_id":"a0000000-0000-4000-8000-000000000001"},
    {"user_id":"a0000000-0000-4000-8000-000000000002"},
    {"user_id":"a0000000-0000-4000-8000-000000000003"}]'::jsonb,
  'monthly', 1,
  (date_trunc('month', current_date) + interval '1 month')::date,
  'a0000000-0000-4000-8000-000000000001'
);


-- ---------------------------------------------------------------------------
-- Expected balances after this seed (a self-check when reviewing the app)
-- ---------------------------------------------------------------------------
--   Total paid  = 450000 + 28750 + 12990 + 34000 = 525740
--   Total owed  = 177514 + 174113 + 174113       = 525740   ✓ (must be equal)
--
--   Maya    paid 484000 (rent + electricity), owes 177514, received 10000
--             →  net = 484000 - 177514 - 10000 = +296486   (₪2,964.86 owed to her)
--   Yonatan paid  28750, owes 174113, sent 10000
--             →  net =  28750 - 174113 + 10000 = -135363   (₪1,353.63 he owes)
--   Noa     paid  12990, owes 174113
--             →  net =  12990 - 174113          = -161123   (₪1,611.23 she owes)
--
--   Sum: 296486 - 135363 - 161123 = 0  ✓  balances always sum to zero.
--
--   Debt simplification turns this into exactly two transfers — Yonatan → Maya
--   and Noa → Maya — which is the minimum possible when one person is the only
--   creditor.
