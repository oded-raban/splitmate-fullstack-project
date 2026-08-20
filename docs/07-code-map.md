# Code Map & Defence

The internal wiki and the presentation Q&A prep in one document. It answers
one question from two directions: _why is the system built this way, and can
it be defended under questioning?_

This document deliberately does not re-explain what `docs/02-architecture.md`
(components, data flow, ADRs) and `docs/03-technical-spec.md` (schema, RLS,
RPCs, CRUD catalogue) already cover in depth — it points at them. Its own job
is two things neither of those documents does: an entry-point map for
navigating the actual codebase fast, and a rehearsed Q&A for the parts of the
system most likely to come up when presenting it.

---

## 1. Where to find things

### 1.1 If you're asked "show me where X happens"

| Question                                                  | Look here                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How does a user become authenticated?                     | `lib/auth.ts` (`getUser`, `requireUser`); `app/auth/callback/route.ts`; `lib/supabase/proxy.ts`                                                                              |
| How is a household's data isolated from another's?        | `supabase/migrations/20260801120000_initial_schema.sql` (RLS policies); `lib/auth.ts` (`requireMembership`)                                                                  |
| How is money represented and split?                       | `lib/domain/money.ts`, `lib/domain/splits.ts` — pure, framework-free, unit-tested                                                                                            |
| How are balances computed?                                | `get_household_balances` in `supabase/migrations/20260801120300_functions.sql`; consumed by `lib/data/expenses.ts`                                                           |
| How does the settle-up debt simplification work?          | `lib/domain/debt-simplify.ts`                                                                                                                                                |
| How does the shopping list stay live across two browsers? | `components/shopping/shopping-list.tsx` (Supabase Realtime subscription + `useOptimistic`)                                                                                   |
| How does a recurring expense actually fire?               | `app/api/cron/recurring/route.ts` → `generate_recurring_expense` RPC; scheduling math in `lib/domain/recurring.ts`                                                           |
| How is a Server Action's result reported to the UI?       | `lib/result.ts` (`ActionResult`), `lib/errors.ts` (`fromDatabaseError`)                                                                                                      |
| How is input validated?                                   | `lib/validation/*.ts` — one Zod schema per feature, shared by client form and Server Action                                                                                  |
| How are environment variables and secrets handled?        | `lib/env.ts`                                                                                                                                                                 |
| Where do the tests live, and what does each layer cover?  | `docs/04-test-plan.md`; `tests/unit`, `tests/components`, `tests/integration`, `tests/e2e`                                                                                   |
| How is the app installable on iPhone/Android?             | `app/manifest.ts`; icon drawn once in `lib/branding/app-icon.tsx`, rendered by `app/icon.tsx`, `app/apple-icon.tsx`, `app/icon-192`, `app/icon-512`, `app/icon-512-maskable` |
| How does a user edit their own name/avatar?               | `app/app/settings/page.tsx`, `components/account/profile-form.tsx`, `lib/actions/profile.ts`                                                                                 |
| Where is the full notification / activity history?        | `app/app/notifications/page.tsx` (per-user, all households); `app/app/households/[householdId]/activity/page.tsx` (per-household audit trail)                                |

### 1.2 Directory structure, one level deep

```
app/                    Next.js App Router — pages, layouts, route handlers
  page.tsx, privacy/, terms/   Public: landing, privacy policy, terms of service
  (auth)/login/          Public marketing-style layout: magic link + Google OAuth
  auth/callback/         Exchanges a magic-link token or OAuth code for a session
  onboarding/            First-run: create or join a household
  app/households/[id]/   Everything behind membership: ledger, shopping, insights,
                          settings, members, invitations, recurring rules
  api/cron/recurring/    Scheduled job — turns due recurring rules into expenses
  api/households/[id]/export/  CSV export route handler

lib/
  actions/               Server Actions — one file per feature, each a set of
                          "authenticate → validate → mutate → report" functions
  data/                  Server-side reads — one file per feature, RLS-scoped
  domain/                Pure business logic: money, splits, balances,
                          debt-simplify, recurring math, CSV. No framework or
                          database import — enforced by an ESLint boundary rule.
  supabase/              Client factories (browser/server), generated DB types
  validation/            Zod schemas, one per feature, shared client/server
  auth.ts, env.ts, errors.ts, result.ts, security.ts   Cross-cutting primitives

components/              One directory per feature, mirroring lib/actions
supabase/migrations/     The database, in order — schema, RLS, RPCs, storage,
                          then the hardening migrations Phase 6 testing produced
tests/                   unit/ · components/ · integration/ · e2e/ (see docs/04)
```

### 1.3 The database, in one paragraph

14 tables, all RLS-enabled: `profiles`, `households`, `household_members`,
`invitations`, `categories`, `recurring_expenses`, `expenses`,
`expense_splits`, `expense_revisions`, `settlements`, `shopping_lists`,
`shopping_items`, `notifications`, `activity_log` — plus the `receipts`
Storage bucket. 13 business-logic RPCs handle every operation that must be
atomic or must bypass RLS deliberately (`create_household`,
`accept_invitation`, `checkout_shopping_items`, `get_household_balances`,
`transfer_ownership`, and others — full list in
`docs/03-technical-spec.md` §5). Full column-level schema, every RLS policy,
and every RPC's SQL is in `docs/03-technical-spec.md` §3–§5; do not
re-memorise it here, know where it is.

---

## 2. Core flows, walked end to end

Four flows, chosen because between them they touch every architectural layer
at least once — pick whichever the conversation needs and narrate file by
file.

### 2.1 Sign in → land in the right place

1. `app/(auth)/login/page.tsx` renders the magic-link form and the Google
   button.
2. Submitting calls the `sendMagicLink` Server Action
   (`lib/actions/auth.ts`), which validates the email with
   `lib/validation/auth.ts`'s `emailSchema` and calls
   `supabase.auth.signInWithOtp`.
3. The emailed link points at `app/auth/callback/route.ts`, which exchanges
   the token for a session and sets cookies.
4. Every subsequent request passes through `lib/supabase/proxy.ts`, which
   calls `getUser()` (verifying the token, not trusting the cookie),
   refreshes it if it's about to expire, and redirects signed-out users away
   from `/app/*`.
5. `app/app/page.tsx` (the dashboard) redirects to `/onboarding` if the user
   has no households, or lists them if they do — the household list itself
   comes from `getHouseholdsForUser` (`lib/data/households.ts`), which is
   just a normal RLS-scoped query: it returns exactly the households
   `household_members` says this user belongs to.

**Likely follow-up:** _"What stops someone from forging a session cookie?"_
→ `getUser()` re-verifies against the Auth server every time; see
`docs/06-security.md` §1.

### 2.2 Log an expense → see the balance

1. `components/expenses/expense-form.tsx` collects description, amount,
   payer, split method and participants; amount is entered in major units
   (e.g. `12.50`) and converted with `lib/domain/money.ts`'s `toMinor` before
   it ever reaches a Server Action.
2. `createExpense` (`lib/actions/expenses.ts`) validates the payload
   (`lib/validation/expenses.ts`), computes the actual per-person split in
   TypeScript using `lib/domain/splits.ts` (equal / exact / percentage /
   shares — see `docs/03-technical-spec.md` §6.2), then calls the
   `create_expense_with_splits` RPC with the _already-computed_ split
   amounts.
3. Inside Postgres, that RPC inserts the expense and its splits in one
   transaction; a **deferred constraint trigger** checks that the splits sum
   exactly to the total before the transaction commits, and rejects it
   otherwise — the database cannot end up holding a corrupt expense even if
   the TypeScript split math had a bug.
4. `revalidatePath` invalidates the household's cached pages; the ledger and
   the balance strip both re-render from `get_household_balances`, which
   recomputes from `expenses` + `expense_splits` + `settlements` on every
   call (§3.1 and §3.1 of `docs/05-scalability.md` explains why that's a
   deliberate trade-off, not an oversight).

**Likely follow-up:** _"Why compute the split in TypeScript and not just pass
percentages to the database?"_ → Rounding. Splitting ₪100 three ways by
percentage produces 33.33/33.33/33.33 — three cents short. The domain layer's
split functions use a largest-remainder allocation so the shares always sum
to exactly the total, and that allocation logic is unit-tested
(`lib/domain/splits.ts`) independent of any database round trip.

### 2.3 Shopping list — the one genuinely realtime feature

1. `components/shopping/shopping-list.tsx` subscribes to Supabase Realtime
   on `shopping_items` filtered to `household_id=eq.<id>` — a filter
   enforced twice: once by the subscription itself, and independently by
   RLS on the underlying table, so even a bypassed client-side filter would
   receive nothing for a household the user isn't a member of.
2. Ticking an item calls `toggleShoppingItem` (`lib/actions/shopping.ts`)
   and _simultaneously_ updates local state via `useOptimistic`, so the
   checkbox responds instantly rather than waiting for a round trip.
3. The Realtime event that the write itself produces arrives back at every
   subscribed client (including the one that made the change) and
   reconciles local state with the server's — the optimistic value is never
   what gets persisted, only what gets _displayed_ until the real update
   confirms or corrects it.
4. "Turn into an expense" calls `checkout_shopping_items`, an RPC that marks
   the checked items resolved and creates the corresponding expense
   atomically — the two must not happen independently, or a crash between
   them would either lose the checked items or create an expense nobody
   asked for.

**Likely follow-up:** _"What if two people check the same item at once?"_ →
The second write is a harmless no-op (idempotent `update ... where checked_at
is null`); whoever's Realtime event arrives second simply reconciles to a
state that already matches, and the UI displays whoever's name landed first.

### 2.4 Recurring expenses — the scheduled path

1. `next_run_at` on a `recurring_expenses` row is computed once, at creation,
   by `firstRunOnOrAfter` (`lib/domain/recurring.ts`) — pure date arithmetic,
   unit-tested against the two hard cases: clamping "the 31st" in a 30-day
   month instead of rolling into the next month, and weekly-recurrence day
   mapping. No framework or database import, same boundary rule as the rest
   of `lib/domain/`.
2. Vercel's cron scheduler hits `app/api/cron/recurring/route.ts` once daily.
   The route has no user session — it authenticates the _caller_ (Vercel)
   via a constant-time comparison of a `Bearer` token against `CRON_SECRET`
   (`lib/security.ts`), not a user identity.
3. It selects every due rule (`next_run_at <= now()`), computes each one's
   split with the same `lib/domain/splits.ts` logic the manual expense form
   uses — deliberately the same code path, so a recurring rent split and a
   manually entered one are calculated identically — and calls
   `generate_recurring_expense`, which is idempotent: calling it twice for
   the same due date does not double-create the expense, which matters
   because a cron retry after a timeout must be safe to simply run again.
4. `log_activity`/`notify_users`, the RPCs that write the activity feed and
   notification entries, had to be patched (migration `20260820010000`)
   specifically because they originally assumed a real `auth.uid()` and
   rejected the cron's service-role calls outright — a concrete example of a
   bug the RLS integration suite (§3, `docs/04-test-plan.md`) caught before
   it reached production.

**Likely follow-up:** _"Why is the cron protected by a secret instead of
Supabase Auth?"_ → There is no human session behind a scheduled job; the
question isn't "who is this user" but "is this really Vercel calling," which
a shared, constant-time-compared secret answers correctly and Supabase Auth
has no mechanism for at all.

---

## 3. Rehearsed technical defence

Answers to the questions this project's specific decisions most obviously
invite. Each is short on purpose — say the one sentence, then point at the
file if pressed further.

**"Why Next.js Server Actions instead of a REST API?"**
The client is the same codebase as the server — there is no separate
frontend consuming a documented API contract, so REST's main benefit
(a stable interface for an independent client) doesn't apply yet. If a
mobile client needed one later, it would be layered over the same
`lib/domain/` and `lib/actions/` logic, not a rewrite (`docs/02-architecture.md`
§6).

**"Why Supabase over a hand-rolled Express + Postgres backend?"**
RLS, Auth, Storage and Realtime are one coherent system with one
authorization model (`auth.uid()`) enforced at the database, rather than four
separate systems that each need their own access-control logic kept in sync.
See `docs/02-architecture.md` §8 for the full library-by-library justification.

**"Why integers for money, not `numeric` or floats?"**
Floats can't represent 0.1 exactly, and the error compounds across splits and
settlements until nothing sums correctly. `numeric` would work but still
needs an explicit scale convention; minor-unit integers make every operation
exact addition with no rounding mode to get wrong, and every test
deterministic. (ADR-3, `docs/02-architecture.md`.)

**"Why derive balances instead of storing them?"**
A stored balance is a cache of financial truth that every write path has to
update correctly, forever; miss one and it drifts permanently with no
indication anything is wrong. A derived value cannot drift — it's
recomputed from the same rows every time. The cost (recomputing over full
history) is named and scoped in `docs/05-scalability.md` §3.1 and §9, not
hidden.

**"How do you know RLS is actually working, not just written?"**
`tests/integration/*.test.ts` — a live suite that signs in as two real,
disposable accounts against the actual hosted Supabase project and asserts
that account B genuinely cannot read, insert, or exploit account A's
household through any table, RPC, or Storage path. Not a mock; a real
attack attempt against the real database, run in CI.

**"What's the worst bug you found and fixed during testing?"**
Two, both surfaced by the integration suite: `preview_invitation` leaking an
invited email address to any signed-in user who obtained the link
(migration `20260820000000`), and the recurring-expense cron's own writes
being rejected by RLS-adjacent checks that assumed a human session
(migration `20260820010000`). Both are in `docs/04-test-plan.md` and
`docs/README.md`'s error/fix history, not swept aside.

**"What would you change with more time?"**
Cache `get_household_balances` (currently recomputed in full on every view),
add a Content-Security-Policy header, and implement account deletion
properly instead of leaving it blocked by the `created_by` foreign-key
constraint. Full, non-cherry-picked lists: `docs/05-scalability.md` §8–9 and
`docs/06-security.md` §9.

**"Parts of this were built with an AI coding agent — how do you stand behind it?"**
Because every decision above has a stated reason, a considered alternative,
and — where the decision was ever gotten wrong — a real bug this project's
own tests found and a real fix that was verified, not assumed. Tooling
changes how fast code gets written; it does not change who is accountable
for what it does once it ships. This document exists specifically to be that
accountability, rehearsed: nothing above is a guess about what the system
does, it is a description of what was actually read, tested, and verified.
