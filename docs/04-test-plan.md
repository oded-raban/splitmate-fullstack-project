# SplitMate — Test Plan

| Field        | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| Product      | **SplitMate** — collaborative expense management for shared households         |
| Document     | Test Plan & Test Implementation                                                |
| Version      | 1.0                                                                            |
| Related docs | [PRD](./01-product-requirements.md) · [Technical Spec](./03-technical-spec.md) |

---

## 1. What this document is for

A test plan for a ledger is not primarily about catching typos — it is about
proving that money cannot be lost, duplicated, or read by the wrong household.
This document says, for each of the PRD's twelve key processes (§7), **what
could go wrong**, **which layer is responsible for preventing it**, and **which
test proves that layer actually does**.

The layer matters because it decides where a test belongs:

| Layer                                | What it proves                                                      | Tooling                                                      |
| ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Pure domain logic (`lib/domain/`)    | The arithmetic is correct, independent of any framework or DB       | Vitest, `tests/unit/`                                        |
| React components                     | A component renders and behaves correctly given props               | Vitest + Testing Library, `tests/components/`                |
| Row-Level Security & RPCs (Postgres) | The authorization boundary holds even if application code has a bug | Vitest against a live Supabase project, `tests/integration/` |
| End-to-end workflows                 | A real user, in a real browser, can actually complete the process   | Playwright, `tests/e2e/`                                     |

A deliberate consequence of this split: **RLS is tested by trying to break it
from a client that has already passed authentication but has no special
privilege** — the same position a compromised or buggy page would be in. A test
that used the service-role key to check "can this user read this row" would
prove nothing, because the service-role key bypasses the exact mechanism under
test.

---

## 2. Process → risk → test matrix

Each row is one of the PRD's key processes. "Automated" means a test in this
repository fails if the behaviour regresses. "Verified" means it was checked
manually and is recorded in `docs/README.md`'s phase walkthroughs, and is a
candidate for automation as the project continues to grow.

### P1 — Registration & Authentication

| Risk                                       | Layer         | Test                                                                                                                                                                          |
| ------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session trusted from an unverified cookie  | App           | `lib/auth.ts` uses `getUser()` exclusively; enforced by code review, not a runtime test — there is no negative case to assert against without a compromised cookie to hand it |
| Protected route reachable while signed out | App           | Verified — `/app` returns 307 to `/login` (docs/README.md, Environment Status)                                                                                                |
| Profile row missing after first sign-in    | DB trigger    | Verified — `handle_new_user` bootstraps `profiles` (docs/README.md, Environment Status)                                                                                       |
| Magic link usable a second time            | Supabase Auth | Delegated — one-time-token consumption is Supabase's contract, not ours to re-test                                                                                            |

### P2 — Household Creation

| Risk                                                                           | Layer                       | Test                                                                                                                                                       |
| ------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation partially succeeds (household with no owner, or no seeded categories) | DB RPC (`create_household`) | Automated — `tests/integration/household-rls.test.ts` asserts owner membership, 8 categories and one shopping list exist immediately after the RPC returns |
| A non-owner ends up with owner privileges                                      | RLS                         | Automated — same file asserts the creator's `household_members.role = 'owner'`                                                                             |

### P3 — Inviting & Joining

| Risk                                                                             | Layer | Test                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An email-targeted invitation preview leaks the invited address to the wrong user | RPC   | Automated — `tests/integration/invitations.test.ts` calls `preview_invitation` as a user other than the invitee and asserts the mismatch is reported without echoing the address                                                       |
| Expired or already-accepted token still joins the household                      | RPC   | Automated — same file, two rules: `expires_at` in the past and `accepted_at` already set both refuse `accept_invitation`                                                                                                               |
| Revoked token still usable                                                       | RPC   | Automated — same file                                                                                                                                                                                                                  |
| Non-member cannot enumerate a household's invitations                            | RLS   | Automated — same file, `invitations_select` scoped to owners/admins of that household                                                                                                                                                  |
| Full accept → land in household → visible to other members                       | E2E   | Verified manually with three accounts (docs/README.md, Phase 3 walkthrough); not re-automated in Playwright because it requires email-round-trip simulation identical to what the integration suite already exercises at the RPC layer |

### P4 — Logging an Expense

| Risk                                                                               | Layer                 | Test                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Splits do not sum to the total                                                     | DB trigger (deferred) | Automated — `tests/integration/expense-integrity.test.ts` inserts a mismatched split set inside a transaction and asserts commit fails               |
| A participant not in the household ends up on a split                              | DB trigger            | Automated — same file, `assert_split_member`                                                                                                         |
| Zero, negative, or absurdly large amount accepted                                  | Domain + Zod          | Automated — `tests/unit/money.test.ts` (`parseAmount`)                                                                                               |
| Remainder allocation differs between the client preview and the server             | Domain                | Automated — `tests/unit/splits.test.ts` (`remainderSeed` regression suite)                                                                           |
| Duplicate rapid submission creates two expenses                                    | RPC                   | Automated — `tests/integration/expense-integrity.test.ts` calls `create_expense_with_splits` twice with the same idempotency key and asserts one row |
| Split calculation itself (equal / exact / percentage / shares, all rounding paths) | Domain                | Automated — `tests/unit/splits.test.ts`, pre-existing                                                                                                |

### P5 — Editing, Deleting & History

| Risk                                                                                         | Layer | Test                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| A plain member (not payer, not creator, not admin) can edit or delete someone else's expense | RLS   | Automated — `tests/integration/expense-integrity.test.ts` attempts an update as an uninvolved member and asserts it is rejected |
| A soft-deleted expense still counts toward balances                                          | RPC   | Automated — same file, deletes an expense and asserts `get_household_balances` excludes it                                      |
| Concurrent edits silently clobber each other                                                 | RPC   | Automated — same file, calls `update_expense_with_splits` with a stale `p_expected_updated_at` and asserts refusal              |

### P6 — Viewing Balances

| Risk                                             | Layer | Test                                                                                                                                       |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Balances do not sum to zero across the household | RPC   | Automated — `tests/integration/expense-integrity.test.ts` sums `net` across all members after a mixed sequence of expenses and settlements |
| A member sees another household's balances       | RLS   | Automated — `tests/integration/household-rls.test.ts`                                                                                      |

### P7 — Settling Up

| Risk                                               | Layer  | Test                                                      |
| -------------------------------------------------- | ------ | --------------------------------------------------------- |
| Settling with yourself, or with a non-member       | RPC    | Automated — `tests/integration/expense-integrity.test.ts` |
| A voided settlement still affects balances         | RPC    | Automated — same file                                     |
| Debt-simplification transfer count and correctness | Domain | Automated — `tests/unit/simplify.test.ts`, pre-existing   |
| Full record-a-payment workflow in the UI           | E2E    | Automated — `tests/e2e/ledger.spec.ts`                    |

### P8 — Shared Shopping List (real-time)

| Risk                                                                              | Layer          | Test                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An item added by one member never appears for another without a refresh           | Realtime       | Automated — `tests/e2e/shopping-realtime.spec.ts`, two independent browser contexts                                                                                                                                                                                                        |
| A tick by one member does not reach the other live                                | Realtime       | Automated — same file                                                                                                                                                                                                                                                                      |
| `shopping_items` / `notifications` silently missing from the Realtime publication | DB config      | Automated — `npm run db:realtime` (checked in CI's `quality` job — see §5)                                                                                                                                                                                                                 |
| A member of another household receives this household's shopping events           | Realtime + RLS | Verified by construction — the subscription filter is `household_id=eq.<id>`, and `items_select` denies the underlying row to a non-member even if the filter were bypassed; not independently re-tested because it would duplicate `household-rls.test.ts`'s coverage of `shopping_items` |
| Checkout with nothing ticked                                                      | App            | Automated — `tests/components/` is not the right layer for this (it is server-validated); covered by `checkoutSchema`'s `min(1)` in `lib/validation/shopping.ts`, exercised indirectly by the E2E checkout flow                                                                            |

### P9 — Receipts

| Risk                                                                             | Layer                | Test                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A member of another household reads or writes into this household's receipt path | Storage RLS          | Automated — `tests/integration/storage-rls.test.ts` attempts to upload/read/list under a path prefixed with a household the caller does not belong to                                          |
| Oversized or wrong-type file accepted                                            | App + Storage config | Verified — bucket `file_size_limit` and `allowed_mime_types` are asserted by `npm run db:check`; client-side rejection covered by manual browser testing (docs/README.md, Phase 5 walkthrough) |
| A receipt is reachable without a signed URL                                      | Storage              | Automated — same file, asserts the bucket is not `public`                                                                                                                                      |

### P10 — Recurring Expenses & Reminders

| Risk                                                         | Layer  | Test                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The 31st" in a 30-day month skips or double-fires           | Domain | Automated — `tests/unit/recurring.test.ts` tests `firstRunOnOrAfter` (`lib/domain/recurring.ts`), which clamps a fixed day to a short month exactly like the PL/pgSQL `advance_recurrence` it complements |
| The cron job runs twice in one day and creates two expenses  | RPC    | Automated — `tests/integration/recurring.test.ts` calls `generate_recurring_expense` twice for the same due date and asserts one expense                                                                  |
| A rule is generated for a date before it was due (backdated) | App    | Automated — `tests/unit/recurring.test.ts`, `firstRunOnOrAfter` never returns a date before `startsOn`                                                                                                    |
| The cron endpoint is callable by anyone who finds the URL    | App    | Automated — `tests/unit/security.test.ts` exhaustively tests `isAuthorizedBearerToken`, the exact function the route calls, extracted specifically so this did not require standing up a server to test   |
| A non-owner/admin creates or edits a recurring rule          | RLS    | Automated — `tests/integration/household-rls.test.ts` extends its cross-role matrix to `recurring_expenses`                                                                                               |

### P11 — Analytics & Reporting

| Risk                                                                | Layer     | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aggregation totals disagree with the sum of individual expenses     | RPC       | Automated — `tests/integration/insights.test.ts` seeds known expenses and asserts `get_monthly_breakdown` / `get_member_stats` totals match, and that both return empty for a non-member                                                                                                                                                                                                                                                                 |
| CSV contains a formula-injection payload or breaks on a comma/quote | Domain    | Automated — `tests/unit/csv.test.ts`, pre-existing                                                                                                                                                                                                                                                                                                                                                                                                       |
| Export leaks a non-member's household data                          | App + RLS | Verified manually (docs/README.md, Phase 5 walkthrough) — the export route re-derives its rows through the same authenticated Supabase client as every other page, so it inherits `expenses_select`'s membership check rather than re-implementing one; not independently re-tested at the HTTP layer because doing so would require a running Next.js server inside the integration suite, which the RPC-level coverage above already makes unnecessary |

### P12 — Notifications

| Risk                                                                      | Layer     | Test                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A client inserts a notification directly (spoofing "your rent was paid")  | RLS       | Automated — `tests/integration/notifications-rls.test.ts` attempts a direct `INSERT` as an authenticated household member and asserts it is rejected — the table has no INSERT policy at all |
| A user reads another user's notifications, even within a shared household | RLS       | Automated — same file                                                                                                                                                                        |
| `notify_users` notifies someone outside the household                     | RPC       | Automated — same file                                                                                                                                                                        |
| Bell badge count and mark-read behaviour                                  | Component | Automated — `tests/components/notification-bell.test.tsx`                                                                                                                                    |

---

## 3. Layers not covered by the matrix above

**`tests/unit/`** (pre-existing, unchanged by Phase 6): `money.test.ts`,
`splits.test.ts`, `balances.test.ts`, `simplify.test.ts`, `csv.test.ts`. These
cover the domain layer exhaustively enough that `vitest.config.mts` enforces a
95%-line / 90%-branch coverage floor scoped to `lib/domain/**`, checked by
`npm run test:coverage`.

**`tests/components/`** (new in Phase 6): components chosen because they hold
logic worth breaking, not because they are the most visually complex.
`ConfirmDialog`'s typed-phrase gate is the one piece of UI in the whole app
whose entire job is to prevent a destructive click, so it gets a dedicated
suite. `NotificationBell`'s unread-count arithmetic and mark-read plumbing is
tested the same way. Purely presentational components (`EmptyState`, badges,
cards) are not separately tested — a snapshot of static JSX proves the test
was written, not that the component works.

**`tests/integration/`** (new in Phase 6): runs against the same hosted
Supabase project as production, using disposable `@splitmate.test` accounts
created and torn down by each test file — the same pattern `scripts/dev-user.mjs`
already established for manual testing. There is no local Postgres in this
project (§"Environment Status" in `docs/README.md`), so "integration" means
"against the real database with real RLS," which is a stronger guarantee than
a mocked client would give and the whole reason this layer exists.

**`tests/e2e/`** (new in Phase 6): two specs, chosen for the two properties
nothing else in this plan can prove — that a person can complete the ledger
workflow through the actual UI, and that two independent browsers genuinely
converge on the shopping list without either being told to refresh.
Playwright's `browser.newContext()` gives each simulated roommate an isolated
cookie jar in a single test process, which is what makes the second spec
possible without running two copies of a test runner.

**Account settings, the notification centre and the household activity page**
(added post-launch, `docs/README.md`'s Phase 9) have no dedicated test file:
they are thin, read-mostly wrappers around `updateProfile`, `getNotifications`
and `getActivity`, all three of which are already exercised — `updateProfile`
by RLS in `supabase/migrations/20260801120200_rls_policies.sql`'s
`profiles_update_own` policy, the other two by the existing notification-bell
and activity-feed component tests plus manual verification (`npm run build`
and a running dev server) at the time they were added. A dedicated test is
the right next addition if either page grows real branching logic.

---

## 4. What is deliberately not automated

- **Google OAuth end-to-end.** Automating a real Google consent screen requires
  either a headless bypass Google actively blocks or a stored session cookie
  that expires unpredictably. Verified manually once (docs/README.md,
  Environment Status) and not re-run on every CI push; a regression here would
  be caught immediately by anyone using the feature, which is not true of a
  ledger correctness bug.
- **Physical file upload in Playwright.** `browser_cdp` documentation and this
  project's own CI sandbox both restrict filesystem-backed file-input
  automation. Receipt upload is covered at the layer that actually enforces its
  rules — Storage RLS and the bucket's own size/type limits (`db:check`) —
  rather than faked in a browser test that would only prove a `<input type=file>`
  exists.
- **Email delivery.** `RESEND_API_KEY` is optional in every environment except
  production; when unset, invitation links are logged rather than mailed. What
  is tested is the token's behaviour once issued (§ P3), not Resend's delivery
  guarantee, which is not this application's code to verify.

---

## 5. Running the suites

| Command                    | Runs                                                                  | When                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm run test`             | Unit + component (`tests/unit`, `tests/components`)                   | Every push and PR (CI `quality`)                                                                                              |
| `npm run test:integration` | RLS/RPC suite against the live Supabase project (`tests/integration`) | Locally before a schema change; on demand in CI (requires the service-role key as a secret, so it does not run on forks' PRs) |
| `npm run test:e2e`         | Playwright, against `PLAYWRIGHT_BASE_URL` or a local dev server       | On every Vercel preview deployment (CI `e2e`, triggered by `deployment_status`)                                               |
| `npm run test:coverage`    | Unit tests with the `lib/domain` coverage gate                        | Locally before a domain-layer change                                                                                          |
| `npm run db:check`         | Schema/RLS/RPC existence assertions against the live project          | After every `db:push`                                                                                                         |
| `npm run db:realtime`      | Publication membership and replica identity                           | After every `db:push`                                                                                                         |

Integration and E2E tests both create and delete their own `@splitmate.test`
accounts and households; a run that is interrupted mid-suite can leave test
data behind, cleaned up by `node scripts/dev-user.mjs cleanup`.

The integration suite signs in dozens of real, disposable users across its
files, and Supabase's own auth rate limiter — sized for a free-tier project,
not a CI fixture factory — can be tighter than that volume in a short window.
`tests/integration/helpers.ts` retries with backoff when it detects a rate
limit, but running the **entire** suite back-to-back-to-back within the same
few minutes (as happens when iterating on it locally) can still exhaust the
window; each file passes in isolation. This is a property of the shared hosted
project (§"Environment Status" above), not a flaw in the tests themselves.
