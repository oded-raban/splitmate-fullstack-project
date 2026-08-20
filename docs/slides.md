---
marp: true
theme: default
paginate: true
size: 16:9
style: |
  section { font-size: 26px; }
  h1 { color: #0f172a; }
  h2 { color: #1d4ed8; }
  code { color: #b91c1c; }
---

<!-- _paginate: false -->

# SplitMate

### Collaborative expense management for shared households

Oded Raban

---

## The problem

Roommates share recurring costs — rent, groceries, utilities — and today that
means:

- A group chat full of "I paid, you owe me" messages nobody trusts
- A spreadsheet one person maintains and everyone else ignores
- No shared shopping list, no receipts, no record of who actually settled up

**The result:** disputes, forgotten debts, and friction in a relationship that
depends on trust.

---

## Who it's for

- **Users:** roommates, flatmates, shared-apartment tenants — 2 to ~8 people
  per household
- **Customer:** the same people are the users; there is no separate paying
  admin — value has to be obvious to _everyone_ in the group, not just
  whoever set it up
- **Business goal:** be the thing a household actually keeps using after week
  one, by removing every reason to fall back to a spreadsheet or a group chat

---

## Business value

| Capability                         | Why it matters                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Shared, real-time ledger           | One number everyone trusts, not a private spreadsheet                         |
| Flexible splitting                 | Equal / exact / percentage / shares — matches how people actually split costs |
| Settle-up with debt simplification | Fewer transfers than "everyone pays everyone" — actually gets used            |
| Live shared shopping list          | Turns a shopping trip directly into a correctly-split expense                 |
| Receipts, insights, CSV export     | The proof and the reporting a spreadsheet gave, without the maintenance       |
| Recurring automation               | Rent never needs to be re-entered manually                                    |

---

## Core workflows

1. Sign in (magic link / Google) → create or join a household
2. Log an expense, split it, see everyone's balance update live
3. Tick items off a shared shopping list in real time → checkout into an expense
4. See who owes whom the fewest possible transfers, and settle up
5. Attach a receipt, browse insights, export a CSV
6. Set up a recurring rule (rent) that posts itself automatically

_(Live demo, if time allows — otherwise: screenshots)_

---

## Architecture — components

```
Browser (Next.js client components)
        │  Server Actions / RSC data fetching
        ▼
Next.js App Router — Vercel
  ├─ Server Components (reads)
  ├─ Server Actions (writes)
  └─ Route handlers (CSV export, cron)
        │  supabase-js (user's own JWT)
        ▼
Supabase — Postgres + Auth + Storage + Realtime
  RLS policies enforce every read and write
```

No separate REST API, no client-side data-fetching library — the client and
server are the same codebase, so Server Components remove the need for one.

---

## Architecture — why Supabase

- **Auth, DB, Storage, Realtime as one coherent system**, sharing a single
  identity (`auth.uid()`) and a single authorization model (RLS) — instead of
  four separate systems each needing their own access control kept in sync
- **Postgres**, not a NoSQL store — this product's data is inherently
  relational (a household has members, expenses, splits, settlements, all
  referencing each other) and needs real transactional guarantees
- **Vercel** for the app, because it's the reference deployment target for
  Next.js and gives free preview deployments per branch/PR

---

## Database schema (14 tables)

```
profiles ─┬─ household_members ─┬─ households ─┬─ categories
          │                     │              ├─ invitations
          │                     │              ├─ recurring_expenses
          │                     │              ├─ shopping_lists ─ shopping_items
          │                     │              ├─ notifications
          │                     │              └─ activity_log
          │                     │
          └─ expenses ─┬─ expense_splits
                        ├─ expense_revisions
                        └─ settlements
```

Plus a private `receipts` Storage bucket, authorized by the object's own
path (`{household_id}/{expense_id}/{uuid}.webp`).

**Every table has Row-Level Security enabled. No exceptions.**

---

## Key technical decisions (ADRs)

| Decision                                     | Because                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **RLS is the authorization boundary**        | Default-deny, applies to every path — app code is opt-in and one forgotten filter leaks data |
| **Balances derived, never stored**           | A cached figure can drift silently; a derived one cannot                                     |
| **Money as integer minor units**             | Floats can't represent 0.1 exactly; errors compound across splits                            |
| **Multi-table writes as Postgres functions** | An expense without its splits is corrupt; PostgREST can't span statements in one transaction |
| **Server Actions, not REST**                 | Client and server are the same codebase — no separate API contract to maintain yet           |

---

## Security

- **Auth:** magic link + Google OAuth (no passwords to leak or reuse); every
  server check uses `getUser()` — never the unverified session cookie
- **Authorization:** RLS is the real boundary; app-level checks exist only
  for a better error message, not as the actual gate
- **Data isolation:** verified live by an integration test suite that signs
  in as two real, disposable accounts and tries to break cross-household
  access — on RLS, RPCs, and Storage alike
- **Hardened after testing found real issues:** an invitation-email leak and
  a cron-job RLS false-rejection, both fixed and now regression-tested
- **Secrets:** validated by schema at startup, split into public/server-only
  modules, service-role key used only where a session genuinely can't exist

---

## Scalability

- Pagination is **cursor-based**, not offset — cost stays constant no matter
  how deep the ledger's history goes, and a concurrent insert can't skip a row
- Every RLS-filtered column has a matching index (`household_id`,
  `spent_at`, `user_id`, ...) — verified by `npm run db:check`
- Server-first data flow: the client never computes a balance or a split and
  asks to be trusted — it sends inputs, the server/database computes the truth
- **Named, not hidden, limitation:** balances are recomputed from full
  history on every view — the right trade-off at this scale, the first thing
  that would need caching at real scale

---

## Testing — 223 automated tests, 3 layers

| Layer            | Tool                   | Count | Proves                                                                   |
| ---------------- | ---------------------- | ----- | ------------------------------------------------------------------------ |
| Unit + component | Vitest + RTL           | 161   | Domain logic (money, splits, debt-simplify, recurrence, security) and UI |
| Integration      | Vitest, live Supabase  | 50    | RLS and RPCs — two real accounts attacking each other's data             |
| End-to-end       | Playwright, 2 browsers | 12    | Full user workflows, including genuine multi-user realtime               |

Full rationale — which workflow risks which layer catches — in
`docs/04-test-plan.md`.

---

## What I'd improve with more time

- Cache `get_household_balances` (currently full-history recompute per view)
- Add a Content-Security-Policy header (needs per-request nonces — scoped,
  not forgotten)
- Real account deletion (currently blocked by a deliberate `created_by`
  foreign-key constraint that protects ledger integrity)
- Application-level rate limiting on Server Actions, beyond Supabase Auth's
  own limiter
- A materialized/incrementally-updated balance if a household's history ever
  grew large enough to make full recomputation measurable

---

<!-- _paginate: false -->

# Thank you

**Live app:** _(Vercel production URL)_
**Repository:** github.com/oded-raban/splitmate-fullstack-project
**Docs:** `docs/01` through `docs/07` — PRD, architecture, tech spec, test
plan, scalability, security, code map & defence

Questions?
