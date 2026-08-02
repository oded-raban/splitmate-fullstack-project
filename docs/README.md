# SplitMate — Project Documentation Index

**Collaborative expense management for shared households.**
RUNI CS 2026 · Internet Technologies: Become a Full-Stack Engineer · Final Project.

---

## Documents

| #   | Document                                                   | Status      | Covers                                                                                                                         |
| --- | ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 01  | [Product Requirements (PRD)](./01-product-requirements.md) | ✅ Complete | Problem, users, customer, business goals, capabilities, 12 key workflows, roles, scope, non-goals, risks                       |
| 02  | [Architecture Design](./02-architecture.md)                | ✅ Complete | Components, database rationale, data flows, page inventory, action/route inventory, permissions, library justifications, ADRs  |
| 03  | [Technical Specification](./03-technical-spec.md)          | ✅ Complete | Directory structure, component architecture, full schema, RLS, RPCs, algorithms, CRUD catalogue, state, errors, validation, UX |
| 04  | Test Plan                                                  | ⏳ Phase 6  | What must be tested and why, per workflow                                                                                      |
| 05  | Scalability                                                | ⏳ Phase 7  | Bottlenecks, indexing, pagination, limits, future work                                                                         |
| 06  | Security                                                   | ⏳ Phase 7  | AuthN/AuthZ, data isolation, validation, secrets, residual risk                                                                |
| 07  | Code Map & Defence                                         | ⏳ Phase 7  | Key files, core flows, technical choices, and the answers to the questions they invite                                         |
| —   | Root `README.md`                                           | ⏳ Phase 4  | Local setup, environment variables, live links                                                                                 |

The internal wiki and the presentation Q&A prep are one document rather than two:
they answer the same question — why is the system built this way — from two
directions, and splitting them guarantees the pair drift apart. Everything above
it stays a separate file, because the assignment's submission list names the PRD,
the technical design, the test plan, scalability and security as separate
deliverables, and a grader ticking that list should find one file per line item.

---

## Assignment Traceability

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
| 8. Scalability document                                   | Phase 7 → `docs/05-scalability.md`                                                                                                 |
| 9. Security document                                      | Phase 7 → `docs/06-security.md`                                                                                                    |
| 10. Deployment & release                                  | Phase 4, first task — the public URL exists before the ledger does                                                                 |
| 11. Coding-agent accountability                           | Every module carries explanatory comments; Deliverable 07 exists so the code can be defended line by line                          |
| 12. Presentation                                          | Phase 7 → slide deck, backed by `docs/07-code-map.md`                                                                              |

---

## Roadmap

| Phase | Contents                                                                                        | Done when                                            |
| ----- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 0     | Repo scaffold, tooling, CI, Supabase init                                                       | ✅ CI green on every push                            |
| 1     | PRD, architecture, technical spec                                                               | ✅ Deliverables 3 and 4 complete                     |
| 2     | Migrations, constraints, RLS, RPCs, generated types                                             | ✅ Applied and verified live                         |
| 3     | Auth, households, invitations                                                                   | ✅ Verified in browser with three accounts           |
| **4** | **Deploy on day one, then expenses, balances, settle-up, activity feed, root README**           | Two people can split rent and settle at a public URL |
| 5     | Realtime shopping list, receipts, insights, notifications, CSV, recurring automation            | Feature-complete                                     |
| 6     | Test plan document, Playwright E2E, RLS integration suite, and the hardening those tests expose | E2E runs in CI against the preview deployment        |
| 7     | Security document, scalability document, code map, slide deck                                   | Submission-ready                                     |

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
