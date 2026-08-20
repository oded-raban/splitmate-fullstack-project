# SplitMate — Project Documentation Index

**Collaborative expense management for shared households.**

---

## Documents

| #   | Document                                                   | Status      | Covers                                                                                                                         |
| --- | ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 01  | [Product Requirements (PRD)](./01-product-requirements.md) | ✅ Complete | Problem, users, customer, business goals, capabilities, 12 key workflows, roles, scope, non-goals, risks                       |
| 02  | [Architecture Design](./02-architecture.md)                | ✅ Complete | Components, database rationale, data flows, page inventory, action/route inventory, permissions, library justifications, ADRs  |
| 03  | [Technical Specification](./03-technical-spec.md)          | ✅ Complete | Directory structure, component architecture, full schema, RLS, RPCs, algorithms, CRUD catalogue, state, errors, validation, UX |
| 04  | [Test Plan](./04-test-plan.md)                             | ✅ Complete | What must be tested and why, per workflow                                                                                      |
| 05  | [Scalability](./05-scalability.md)                         | ✅ Complete | Bottlenecks, indexing, pagination, limits, future work                                                                         |
| 06  | [Security](./06-security.md)                               | ✅ Complete | AuthN/AuthZ, data isolation, validation, secrets, residual risk                                                                |
| 07  | [Code Map & Defence](./07-code-map.md)                     | ✅ Complete | Key files, core flows, technical choices, and the answers to the questions they invite                                         |
| —   | [Slide Deck](./slides.md)                                  | ✅ Complete | Marp-format slides for the 10–15 minute presentation                                                                           |
| —   | Root `README.md`                                           | ✅ Complete | What the app does, the live URL, and — secondarily — local setup and environment variables                                     |

The internal wiki and the presentation Q&A prep are one document rather than two:
they answer the same question — why is the system built this way — from two
directions, and splitting them guarantees the pair drift apart. Everything above
it stays a separate file, because the product brief names the PRD, the
technical design, the test plan, scalability and security as separate
deliverables, and a reviewer checking that list should find one file per line
item.

---

## Requirements Traceability

Every numbered requirement in `project-requirements.md`, mapped to where it is satisfied.

| Requirement                                               | Where                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1. Product selection with business value                  | [PRD §1–§4](./01-product-requirements.md)                                                                                          |
| 2. Product specification document                         | [PRD](./01-product-requirements.md) — problem, users, customer, business goals, capabilities, key processes                        |
| 3. Software architecture design                           | [Architecture](./02-architecture.md) — components, DB, pages, actions/routes, data flow, roles, external services                  |
| 4. Detailed technical specification                       | [Technical Spec](./03-technical-spec.md) — structure, components, schema, CRUD, API, business logic, state, errors, validation, UX |
| 5. Implementation (Next.js, TypeScript, Supabase, Vercel) | Phases 2–5                                                                                                                         |
| 6. Test plan document                                     | Phase 6 → `docs/04-test-plan.md`                                                                                                   |
| 7. Test implementation (Vitest, RTL, Playwright)          | Phase 6 → `tests/`                                                                                                                 |
| 8. Scalability document                                   | [Scalability](./05-scalability.md)                                                                                                 |
| 9. Security document                                      | [Security](./06-security.md)                                                                                                       |
| 10. Deployment & release                                  | Phase 4, first task — the public URL exists before the ledger does                                                                 |
| 11. Coding-agent accountability                           | Every module carries explanatory comments; [Code Map & Defence](./07-code-map.md) exists so the code can be defended line by line  |
| 12. Presentation                                          | [Slide Deck](./slides.md), backed by [Code Map & Defence](./07-code-map.md)                                                        |

---

## Roadmap

| Phase | Contents                                                                                            | Done when                                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0     | Repo scaffold, tooling, CI, Supabase init                                                           | ✅ CI green on every push                                                                                     |
| 1     | PRD, architecture, technical spec                                                                   | ✅ Deliverables 3 and 4 complete                                                                              |
| 2     | Migrations, constraints, RLS, RPCs, generated types                                                 | ✅ Applied and verified live                                                                                  |
| 3     | Auth, households, invitations                                                                       | ✅ Verified in browser with three accounts                                                                    |
| 4     | Deploy on day one, then expenses, balances, settle-up, activity feed, root README                   | ✅ Rent split and settled at the public URL                                                                   |
| 5     | Realtime shopping list, receipts, insights, notifications, CSV, recurring automation                | ✅ All six verified in the browser                                                                            |
| **6** | **Test plan document, Playwright E2E, RLS integration suite, and the hardening those tests expose** | ✅ 161 unit/component + 50 integration + 12 E2E tests green; E2E wired into CI against the preview deployment |
| 7     | Security document, scalability document, code map, slide deck                                       | ✅ All four deliverables complete                                                                             |
| 8     | Installable PWA — manifest, icons, iOS/Android home-screen support                                  | ✅ Verified via `next build` and a running dev server (see below)                                             |
| 9     | Post-launch hardening — account settings, notification centre, full audit trail, requirements pass  | ✅ See walkthrough below                                                                                      |

Four phases where there were eight. The compression is not optimism — it comes
from two properties of the current state.

The database is finished for _every_ feature, not just the MVP: all 14 tables,
their RLS policies, 13 RPCs and the receipts storage bucket are already deployed.
Shopping lists, notifications, recurring rules and the analytics aggregations all
have their schema and business logic in Postgres. What remains for each is a thin
application layer, and thin layers batch — hence one phase for all of Tier 1
rather than three.

And the app already runs signed-in, multi-user flows, so nothing needs building
before it can go live. Deploying first satisfies deliverables 1, 2 and 9
permanently and makes every later push continuously verified against real
infrastructure, instead of discovering environment and redirect-allow-list
problems in the last week — which is the usual way a late deployment phase fails.

Phases 6 and 7 may overlap; the boundary marks feature freeze, not a hard stop.
Recurring-expense automation is the designated cut if the schedule tightens: it
is the only Tier 1 item whose cost (a cron route, idempotency handling, and
Vercel's Hobby tier permitting only daily schedules) is disproportionate to the
marks it earns.

---

## Deployment

Vercel's GitHub integration is connected (`oded-raban/splitmate-fullstack-project`,
production branch `main`), so every push to `main` deploys to production and every
other branch or pull request gets its own preview URL automatically — no manual
`vercel --prod` required.

### Rendering the slide deck

`docs/slides.md` is [Marp](https://marp.app/)-formatted Markdown — plain text,
diffable, and viewable as-is in any Markdown viewer. To export it as a PDF or
PPTX for the actual presentation:

```bash
npx @marp-team/marp-cli docs/slides.md -o docs/slides.pdf
npx @marp-team/marp-cli docs/slides.md -o docs/slides.pptx
```

No dependency install required — `npx` fetches Marp's CLI on demand and it is
not added to `package.json`, since nothing in the running application needs
it.

### E2E-against-preview CI job

`.github/workflows/ci.yml`'s `e2e` job fires on GitHub's `deployment_status`
event — which Vercel's integration reports once a preview finishes building —
and points Playwright at `github.event.deployment_status.target_url` instead of
a local dev server. It needs three repository secrets, the same values already
in `.env.local`, added under **Settings → Secrets and variables → Actions**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Every test account it creates lives on the `@splitmate.test` domain and is
deleted in the same run's `afterAll`, so this is safe to run against the one
shared hosted Supabase project rather than needing an ephemeral database per
preview.

---

## Environment Status

There is no local Postgres container in this project. Docker is not installed on
the development machine, so the hosted Supabase project is the single database
for both development and production. The practical consequences:

- `npm run db:push` applies migrations to the hosted project over a direct
  Postgres connection (`SUPABASE_DB_URL`).
- `npm run db:types` regenerates `lib/supabase/database.types.ts` by reading the
  schema over the Management API (`SUPABASE_ACCESS_TOKEN`), because the CLI's
  `--db-url` route runs postgres-meta inside a container.
- `npm run db:check` is the safety net this arrangement needs. `db push`
  reporting success only proves the SQL executed; the check confirms PostgREST
  can see all 14 tables, that RLS denies an anonymous caller, and that all 11
  business RPCs are exposed.
- `supabase/seed.sql` is **not** applied to the hosted project. It creates
  auth users with a known password, which is acceptable in a throwaway local
  container and not acceptable in a database that will also serve production.

### Verified working

| Chain                     | Evidence                                                                         |
| ------------------------- | -------------------------------------------------------------------------------- |
| Schema, RLS, RPCs         | `npm run db:check` passes all 29 assertions                                      |
| Magic-link callback       | Token verified, session cookie set, redirect to `/app`                           |
| Profile bootstrap trigger | `handle_new_user` created the `profiles` row with the display name from metadata |
| Protected routes          | `/app` returns 307 to `/login` without a session                                 |
| Sign-out                  | Session cleared, redirect to `/login`                                            |
| Google OAuth              | Reaches Google's consent screen with the correct client ID and redirect URI      |

### Phase 3 walkthrough

Exercised in the browser with three throwaway accounts (`scripts/dev-user.mjs`),
then deleted. Each row is a rule the code claims to enforce, checked by trying to
break it rather than by reading the implementation:

| Attempted                                        | Result                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| Create a household                               | Owner membership, default categories and shopping list seeded atomically |
| Open an email-bound invitation as the wrong user | Refused as a mismatch, without revealing the invited address             |
| Accept an invitation                             | Joined as member and landed in the household                             |
| Re-open a consumed invitation link               | Refused as already used — single-use holds                               |
| View members as a plain member                   | No invite control, no manage menus, no settings tab                      |
| Request `/settings` as a plain member            | 404, identical to a household that does not exist                        |
| Open a household after being removed             | 404 — no confirmation that the household exists                          |
| Manage members as an admin                       | Role changes and removal allowed; ownership transfer withheld            |
| Remove a member                                  | Typed confirmation required; member list revalidated immediately         |
| Rename a household                               | Propagated to the heading and the switcher in the shared layout          |

Three defects surfaced and were fixed rather than noted: the accept flow
navigated from the client and so re-rendered the invitation page after consuming
its own token, greeting the invitee with "already used" (now redirected from the
Server Action); relative timestamps caused a hydration mismatch (now isolated in
`components/common/time-ago.tsx`); and `notFound()` thrown from the household
layout fell through to the framework's bare 404, since a layout cannot render a
boundary nested inside itself (boundary moved up to `app/app/not-found.tsx`).

### Phase 5 walkthrough

Two gaps had to be closed before any of Tier 1 could work, both invisible from
the schema alone: `shopping_items` and `notifications` were never added to the
`supabase_realtime` publication (migration `20260803180000`), and no RPC existed
to turn a `recurring_expenses` row into an actual expense. Both are now in place,
and `npm run db:realtime` asserts the publication membership and replica
identity so a future migration cannot silently drop them again.

| Feature                | Verified                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Realtime shopping list | Item ticked by one client shows "got by you" / sinks below unticked items; a second checked item enables checkout       |
| Checkout → expense     | "Turn into an expense" posts through `checkout_shopping_items`, lands on the new expense's detail page, ledger updated  |
| Receipt upload         | Panel renders the upload affordance on an expense with no receipt; direct-to-Storage path avoids the 4.5MB Action limit |
| Insights               | Monthly bar chart and category donut render from `get_monthly_breakdown` / `get_member_stats`; range switch updates URL |
| CSV export             | Route handler streams a signed-in, RLS-scoped file; formula-injection and quoting covered by `tests/unit/csv.test.ts`   |
| Notification bell      | Badge count matches unread rows; opening a notification marks it read and deep-links to the relevant page               |
| Recurring rules        | Rule creation resolves the correct first `next_run_at` (never backdated); cron route protected by a constant-time token |

Two defects surfaced during this phase and were fixed rather than shipped: the
notification bell's props-to-state sync used `setState` inside a `useEffect`,
which the `react-hooks/set-state-in-effect` lint rule correctly flagged as a
one-frame flash of stale content — moved to an in-render adjustment instead. A
`console.log` in the cron route's summary line was downgraded to `console.info`
to satisfy the project's `no-console` policy, which exists so a stray debug
`console.log` is caught by CI rather than surviving into production output.

One hydration warning appeared during manual testing and was investigated rather
than dismissed: React's dev overlay flagged a `data-cursor-ref` attribute on the
header's home link that the server never rendered. That attribute is injected by
the browser-automation harness used to drive the verification pass, not by
application code — confirmed by diffing the exact attribute the overlay named
against every prop the component actually sets. No application change was made.

One constraint worth recording early: an `auth.users` row cannot be deleted while
rows they created still exist, because every `created_by` column references
`profiles` with no `ON DELETE` action. That is the right rule for a ledger — an
expense must always name who recorded it — and it means account deletion in
Phase 10 has to tombstone and scrub a profile rather than remove it.

The Supabase redirect allow-list must contain `http://localhost:3000/auth/callback`
(and the Vercel origin once deployed). Note the `/auth/` segment: the handler is
`app/auth/callback/route.ts`, deliberately outside the `(auth)` route group so
that the group's centred marketing layout does not wrap a route that renders
nothing.

### Phase 8 walkthrough — installable PWA

The app was already responsive (every page is built to the phone breakpoint,
per `docs/03-technical-spec.md` §11); what it lacked was the pieces that let a
phone offer to install it. This phase added, without touching a single
feature page:

| Piece                                     | Implementation                                                                                                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web App Manifest                          | `app/manifest.ts` — Next.js's file convention, served at `/manifest.webmanifest` and linked automatically                                                                                                                                                       |
| App icon (favicon, home-screen, manifest) | `lib/branding/app-icon.tsx` draws the same wallet mark as the header badge once; `app/icon.tsx`, `app/apple-icon.tsx` and the `icon-192`/`icon-512`/`icon-512-maskable` routes all render it via `next/og`'s `ImageResponse` instead of five hand-exported PNGs |
| iOS-specific meta (`app/layout.tsx`)      | `appleWebApp` (standalone title, status bar style) — Safari on iOS never fully adopted the manifest for these                                                                                                                                                   |

Two real bugs surfaced while verifying this end to end rather than just reading
the code, both fixed rather than shipped:

1. **`lib/supabase/proxy.ts` redirected `/apple-icon` to `/login`.** Its route
   guard checked `pathname.startsWith("/app")` to protect `/app/**`, and the
   _string_ `/app` is also a prefix of the _string_ `/apple-icon` — an
   unrelated route that happens to share the same six characters. Every
   unauthenticated request for the PWA's home-screen icon was silently
   bounced to the login page, which would have made "Add to Home Screen" show
   a blank icon on a real phone. Replaced with `isUnderPath()` in
   `lib/security.ts`, which requires an exact match or a `/`-bounded segment,
   and added `tests/unit/security.test.ts` cases that assert `/apple-icon` and
   `/application` are _not_ under `/app` while `/app/households/123` is.
2. **`app/icon.tsx`'s `id` prop is a `Promise<string>`, not a `string`.**
   Passing it straight to `Number()` produced `NaN` for every requested
   favicon size, which Satori (the renderer behind `ImageResponse`) failed on
   with an opaque `"inputValue.trim is not a function"` error deep inside its
   CSS parser rather than a clear type error. Fixed by awaiting `id` before
   using it.

Both were caught by actually requesting every generated route (`/icon-192`,
`/icon-512`, `/icon-512-maskable`, `/icon/16`, `/icon/32`, `/icon/48`,
`/apple-icon`, `/manifest.webmanifest`) against a running dev server and a
`next build`, and confirmed fixed the same way — not by inspection.

To verify installability on a real device: open the deployed URL in Safari on
iPhone and use Share → **Add to Home Screen**, or in Chrome on Android and use
the **⋮ menu → Install app** (Chrome's own install-prompt criteria — a served
manifest with the required fields and icons over HTTPS — are satisfied by
`app/manifest.ts` alone; no service worker is required for installability).
Both should show the wallet icon and launch straight into `/app` in
standalone mode, with no browser chrome.

No offline support or service worker was added deliberately: every page in
SplitMate reads live, per-request data (balances, shopping-list state,
notifications), so a cached shell would either show stale numbers or need its
own cache-invalidation logic to avoid it — complexity with no user-facing
payoff for an app whose entire value proposition is that the numbers are
current.

---

### Phase 9 walkthrough — post-launch hardening

A pass over `project-requirements.md` against the deployed app found two
pages the architecture document (`docs/02-architecture.md` §5) had always
promised but that were never actually built:

| Documented page                              | Reality before this phase                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/app/settings` — "Profile and preferences"  | Did not exist. The account menu's **Your profile** link pointed at it anyway, so clicking it 404'd. |
| `/app/notifications` — "Notification centre" | Did not exist either. The same menu's **Notifications** link 404'd, and used the wrong icon.        |

Both are now real pages, not stubs:

- **`app/app/settings/page.tsx`** + **`components/account/profile-form.tsx`** —
  edit your display name and avatar URL, backed by the `updateProfile` Server
  Action and the `profiles_update_own` RLS policy that already existed in the
  schema (migration `20260801120200`) with no application code ever using it.
- **`app/app/notifications/page.tsx`** + **`components/notifications/notification-list.tsx`** —
  every recent notification across every household, not just the header
  bell's 20-item dropdown. Reuses the bell's own `describe()`/`linkFor()`
  functions (now exported from `notification-bell.tsx`) so the wording of a
  notification cannot drift between the two surfaces.

A third gap surfaced while cross-checking the same architecture table: a
documented `/app/households/[id]/activity` page ("Full audit trail") existed
only as an inline, 12-entry "Recent activity" card on the household home
page — no dedicated route, and no way to see anything older. Added
**`app/app/households/[householdId]/activity/page.tsx`**, a plain read-only
list (no client component needed — it is not interactive) capped at 300
entries, linked from a new **Activity** tab in the household nav and a
"View all" link on the home page's card.

None of these were silent placeholders — each was a page the docs described,
the nav or account menu already linked to, and that a real user (or anyone
reading the architecture doc against the live app) would hit and find
missing. All three now typecheck, lint, and build cleanly, and the existing
161-test unit/component suite still passes unmodified.

A second pass, prompted by re-reading `project-requirements.md` end to end
against the deployed app rather than against this document, found two more
gaps and one documentation-only drift, all now closed:

- **`/privacy` and `/terms` were documented in `docs/02-architecture.md` §5
  but never built**, and nothing in the app linked to them — no active 404,
  but a real app asking people to sign in with Google should have both, and
  Google's own OAuth consent screen expects a privacy policy link for a
  production app. Added `app/privacy/page.tsx` and `app/terms/page.tsx`,
  written by hand against what the app actually does (not templated
  boilerplate), and linked from the landing page footer and the login page's
  existing "by continuing you agree" line. `/pricing` was documented
  alongside them but removed from the architecture doc's page table instead
  of built — monetisation is deliberately "designed, not implemented" (PRD
  §4.3), so a pricing page with no real plan to price would be misleading
  rather than honest.
- **The CSV export route's documented path didn't match its real one.**
  `docs/02-architecture.md` said `/api/export/[householdId]`; the route
  handler has always lived at `/api/households/[householdId]/export/route.ts`.
  `docs/06-security.md` and `docs/07-code-map.md` already had the correct
  path — only the architecture doc had drifted. Fixed in both places it
  appeared.
- **`docs/02-architecture.md`'s Environments table claimed a local Supabase
  CLI stack (Docker, a local Postgres) that this project has never used** —
  directly contradicting `docs/README.md`'s own "Environment Status" section
  a few hundred lines below, which correctly describes one hosted project
  shared by local development, preview and production. The architecture doc
  now says the same thing the status section does, instead of describing an
  earlier plan that was never carried out.

The root `README.md` was also rewritten: it previously spent most of its
length on local setup, as if running the code locally were the primary way
to use it, when the actual product is a hosted app anyone can open by URL
today. The live link, what the product does, and how to share it with
someone now come first; local setup is still complete but explicitly framed
as being for contributors, not a prerequisite for using SplitMate.

---

## Decisions Locked

Product name **SplitMate** · Currency ILS per household, no FX · Auth via magic link + Google OAuth · Full Tier 1 scope (realtime shopping list, receipts, recurring automation, analytics, notifications, CSV export) · Stack: Next.js App Router, TypeScript strict, Supabase (Postgres/Auth/Storage/Realtime), Tailwind + shadcn/ui, Zod, Vitest + Playwright, Vercel.

## Load-Bearing Technical Positions

These are the answers that will be probed in the presentation, stated once here for quick revision:

1. **Money is stored as integer minor units.** Floating point cannot represent 0.1 exactly and the error compounds across splits.
2. **Balances are derived, never stored.** A cached financial figure can drift; a derived one cannot.
3. **Splits must sum to the total, enforced by a deferred database trigger.** The database structurally cannot hold a corrupt expense.
4. **Row-Level Security is the authorization boundary.** Application checks improve error messages; RLS is what actually prevents a leak.
5. **`SECURITY DEFINER` helper functions with a pinned `search_path`** exist to break RLS recursion on `household_members` — and pinning the path is what makes that safe.
6. **Server Actions instead of REST**, because the client is colocated with the server; a public API would be added over the same domain layer if a mobile client ever needed one.
7. **Debt simplification is a greedy heuristic bounded at n−1 transfers**, not a proven optimum — exact minimisation is NP-hard.
