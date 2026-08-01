# SplitMate — Project Documentation Index

**Collaborative expense management for shared households.**
RUNI CS 2026 · Internet Technologies: Become a Full-Stack Engineer · Final Project.

---

## Documents

| # | Document | Status | Covers |
| --- | --- | --- | --- |
| 01 | [Product Requirements (PRD)](./01-product-requirements.md) | ✅ Complete | Problem, users, customer, business goals, capabilities, 12 key workflows, roles, scope, non-goals, risks |
| 02 | [Architecture Design](./02-architecture.md) | ✅ Complete | Components, database rationale, data flows, page inventory, action/route inventory, permissions, library justifications, ADRs |
| 03 | [Technical Specification](./03-technical-spec.md) | ✅ Complete | Directory structure, component architecture, full schema, RLS, RPCs, algorithms, CRUD catalogue, state, errors, validation, UX |
| 04 | Test Plan | ⏳ Phase 9 | What must be tested and why, per workflow |
| 05 | Scalability | ⏳ Phase 10 | Bottlenecks, indexing, pagination, limits, future work |
| 06 | Security | ⏳ Phase 10 | AuthN/AuthZ, data isolation, validation, secrets, residual risk |
| 07 | Internal Wiki / Code Map | ⏳ Phase 11 | Key files, core flows, technical choices |
| 08 | Presentation Q&A Prep | ⏳ Phase 11 | Anticipated technical questions and answers |
| — | Root `README.md` | ⏳ Phase 6 | Local setup, environment variables, live links |

---

## Assignment Traceability

Every numbered requirement in `project-requirements.md`, mapped to where it is satisfied.

| Requirement | Where |
| --- | --- |
| 1. Product selection with business value | [PRD §1–§4](./01-product-requirements.md) |
| 2. Product specification document | [PRD](./01-product-requirements.md) — problem, users, customer, business goals, capabilities, key processes |
| 3. Software architecture design | [Architecture](./02-architecture.md) — components, DB, pages, actions/routes, data flow, roles, external services |
| 4. Detailed technical specification | [Technical Spec](./03-technical-spec.md) — structure, components, schema, CRUD, API, business logic, state, errors, validation, UX |
| 5. Implementation (Next.js, TypeScript, Supabase, Vercel) | Phases 2–8 |
| 6. Test plan document | Phase 9 → `docs/04-test-plan.md` |
| 7. Test implementation (Vitest, RTL, Playwright) | Phase 9 → `tests/` |
| 8. Scalability document | Phase 10 → `docs/05-scalability.md` |
| 9. Security document | Phase 10 → `docs/06-security.md` |
| 10. Deployment & release | Phase 6 (initial), Phase 11 (final) |
| 11. Coding-agent accountability | Every module carries explanatory comments; Deliverable 07 + 08 exist so the code can be defended line by line |
| 12. Presentation | Phase 11 → slide deck + Q&A prep |

---

## Roadmap

| Phase | Contents | Milestone |
| --- | --- | --- |
| 0 | Repo scaffold, tooling, CI, Supabase projects | — |
| **1** | **PRD, architecture, technical spec** | **M1 ✅** |
| 2 | Migrations, constraints, RLS, RPCs, seeds, generated types | M2 |
| 3 | Auth, households, invitations | M3 |
| 4 | Expense engine: domain layer, CRUD, history | M4 |
| 5 | Balances, settlements, activity feed — **MVP complete** | M5 |
| 6 | Deploy to Vercel + production Supabase | M6 |
| 7 | Realtime shopping list, receipts | M7 |
| 8 | Recurring automation, notifications, insights, CSV | M8 |
| 9 | Test plan + Vitest / RTL / RLS / Playwright suites | M9 |
| 10 | Security & scalability documents plus hardening | M10 |
| 11 | README, wiki, slide deck, Q&A prep | M11 |

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
