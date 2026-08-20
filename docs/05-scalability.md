# Basic Scalability

How SplitMate behaves as the number of households, members and ledger history
grows, what would break first, and what the fix is when it does.

The honest framing: at the scale this product targets today — tens to low
hundreds of concurrent users, spread across many small households of 2–6
people — nothing here needs to change. The value of this document is knowing
_which_ assumption breaks first if that stopped being true, because "it works
today" and "I know why it will eventually stop working, and where" are
different claims, and only the second one is engineering.

---

## 1. What "scale" means for this product

A single household is small by construction — 2 to maybe 8 roommates — and
that ceiling is set by the product, not the database. The dimension that
actually grows is the **number of independent households** and, within a
long-lived household, the **length of its expense history**. Every capacity
question in this document is really one of those two.

This matters because it means SplitMate scales the way a multi-tenant SaaS
product scales — horizontally, across many small, RLS-isolated tenants —
rather than the way a single shared dataset scales. A thousand households
each with 200 expenses is a completely different (and easier) shape than one
household with 200,000 expenses, and the schema is designed for the former.

---

## 2. Tens to hundreds of users

Nothing changes at this scale, for three independent reasons:

- **Supabase's connection pooler** (PgBouncer, transaction mode) sits in front
  of Postgres. Next.js Server Actions and Server Components open short-lived
  connections per request; the pooler multiplexes hundreds of these onto a
  handful of real Postgres backends. The application never manages a
  connection pool itself — see `lib/supabase/server.ts` and
  `lib/supabase/proxy.ts`.
- **Every list is paginated or bounded** (§5), so a page's cost does not grow
  with the number of users on the platform, only with the size of the one
  household being viewed.
- **RLS filters at the database, not in application code.** Every query
  already carries `household_id = ...` predicates, backed by indexes (§4), so
  adding the 500th household does not slow down a query scoped to household
  #12 — Postgres is filtering rows via an index seek, not scanning a
  monolithic shared table in memory.

The one place load is _not_ per-request-bounded is the nightly cron
(`app/api/cron/recurring/route.ts`), which iterates every due
`recurring_expenses` row on the whole platform in one invocation. At tens of
households this is trivially fast; at thousands of active recurring rules it
would be the first thing to need pagination. See §7.

---

## 3. Which queries would become heavy bottlenecks

Ranked by how directly their cost scales with data that is _not_ bounded by
pagination:

### 3.1 `get_household_balances` — the real bottleneck candidate

```
supabase/migrations/20260801120300_functions.sql
```

Balances are deliberately **derived, never stored** (see
`docs/02-architecture.md`'s ADRs) — a cached balance can drift from reality,
and a derived one cannot. The cost of that correctness is that every call
aggregates `sum(amount_minor)` and `sum(share_minor)` over **every expense the
household has ever recorded**, not just recent ones. A household still
splitting rent five years and 3,000 expenses from now pays for all 3,000 rows
every time anyone opens the household page.

This is the one query in the schema whose cost is unbounded by construction,
and it is called on the single most-visited page in the app (the household
home). It is not a problem at this project's scale — Postgres aggregates
3,000 narrow, indexed rows in single-digit milliseconds — but it is the
correct answer to "which query breaks first at real scale," and the fix is
already scoped in §8.

### 3.2 `get_monthly_breakdown` / `get_member_stats` (Insights)

Same shape as §3.1: both aggregate the full `expenses`/`expense_splits`
history for the household, filtered by a date range at the SQL level (not
fetched-then-filtered). Bounded by the UI's own range picker
(`components/insights/`), which defaults to a recent window rather than "all
time," so the common case is already cheap. The "all time" option is the one
that inherits §3.1's cost profile.

### 3.3 The expense feed — already solved, included for contrast

`getExpenses` (`lib/data/expenses.ts`) is the one place a naive design would
usually create the worst bottleneck (`OFFSET n` pagination over a growing
table), and it is the one place this project deliberately did not use the
naive design. See §5.

### 3.4 The cron sweep

`app/api/cron/recurring/route.ts` selects every `recurring_expenses` row
where `next_run_at <= now()`, across all households, in one query. Indexed
(`idx_recurring_due`) and cheap at any realistic count of recurring rules at
today's scale; flagged here because it is the one query whose result set
grows with total platform size rather than one household's size, same as the
cron concern in §2.

---

## 4. Is database indexing required?

Required, and already in place — every foreign key that a policy or a query
filters on has a matching index, created in
`supabase/migrations/20260801120000_initial_schema.sql` and verified live by
`npm run db:check`. The ones that matter most for scale:

| Index                      | Table                | Why it exists                                                                          |
| -------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `idx_expenses_feed`        | `expenses`           | `(household_id, spent_at desc, id desc)` — the exact shape `getExpenses`' cursor needs |
| `idx_expenses_payer`       | `expenses`           | Speeds the `paid` aggregate inside `get_household_balances`                            |
| `idx_expenses_category`    | `expenses`           | `(household_id, category_id, spent_at)` — category filter on the ledger and insights   |
| `idx_splits_by_user`       | `expense_splits`     | The `owed` aggregate and "your share" lookups                                          |
| `idx_settlements_from/to`  | `settlements`        | Partial indexes (`where voided_at is null`) — only live settlements are ever summed    |
| `idx_members_by_user`      | `household_members`  | Every RLS policy's `is_household_member` check joins through this                      |
| `idx_notifications_unread` | `notifications`      | `(user_id, created_at desc)` — the bell's unread query, per user, not per household    |
| `idx_activity_feed`        | `activity_log`       | `(household_id, created_at desc)` — the activity tab's own cursor                      |
| `idx_recurring_due`        | `recurring_expenses` | The cron sweep's `next_run_at <=` predicate                                            |

The settlement indexes are **partial** (`where voided_at is null`) rather than
full-table, on purpose: a voided settlement is kept for audit but never
appears in a balance calculation again, so indexing it would only ever waste
space and slow down every write that touches the table.

---

## 5. Preventing unnecessary data fetching

- **Server Components fetch only what the page renders**, in the same request
  that renders it — no client-side waterfall of "load page, then fetch data."
  A list page's data function selects exactly the columns the UI displays
  (see any `lib/data/*.ts` file), never `select("*")` into a table with columns
  the page does not use.
- **Nested selects instead of N+1 round trips.** `getExpenses` fetches an
  expense, its category and all of its splits in one PostgREST query via
  embedded resources (`categories ( name, icon )`, `expense_splits (...)`),
  rather than one query per expense per related table.
- **`export/route.ts` caps rows at `MAX_ROWS = 5000`** even though a
  household's RLS-scoped data could theoretically be larger — an export is a
  one-shot batch operation, and an unbounded one is the textbook way an
  innocuous "download my data" button becomes a denial-of-service vector
  against your own database.
- **Realtime subscriptions are scoped per household** (`household_id=eq.<id>`
  filters in `components/shopping/shopping-list.tsx`), so a client never
  receives — and never has to discard — events for a household it is not
  currently viewing.

---

## 6. Pagination

Two different pagination strategies are used, each fitted to what it paginates:

- **Cursor-based, for the expense ledger** (`lib/data/expenses.ts`). The
  cursor encodes the last row's `(spent_at, id)` tuple, base64url-encoded, and
  the next page seeks with `(spent_at, id) < cursor` — the same predicate the
  `idx_expenses_feed` index was built for. This was a deliberate choice over
  `OFFSET`/`LIMIT`: offset pagination makes page _N_ cost proportional to _N_
  (Postgres still has to walk and discard the skipped rows), and a row
  inserted while someone pages through history shifts every subsequent offset
  by one — silently skipping or duplicating a row. A cursor costs the same at
  any depth and cannot skip a row, because it does not count rows at all, it
  seeks to a value.
- **Range-bounded, for everything else that lists rows** (activity feed,
  notifications) — the same `(household_id/user_id, created_at desc)` index
  shape, `.limit(N)` with no offset, "load more" appends rather than
  re-paginating from zero.

No list in the product renders with `OFFSET` past the first page. This was a
design decision made before implementation (`docs/03-technical-spec.md`), not
a fix applied after a slow query was noticed.

---

## 7. Separation of concerns: client vs. server

- **All money-moving reads and writes happen on the server** — Server
  Components for reads, Server Actions for writes (`lib/actions/*.ts`) — and
  every one of them re-derives the caller's identity from a verified session
  (`getUser()`, never a client-supplied user id). The client never computes a
  balance, a split, or a debt-simplification transfer and sends the _result_
  to be trusted; it sends the _inputs_, and the server (or a database RPC)
  computes the outcome. This is what makes the architecture safe to scale
  horizontally — a client cannot become an attack surface for a wrong number
  it wasn't allowed to compute.
- **The one deliberate exception — client-side optimistic UI — never
  persists.** The shopping list (`components/shopping/shopping-list.tsx`)
  updates its local state immediately on a tick, before the Server Action
  confirms it, purely so the UI feels instant; Realtime reconciliation then
  either confirms or reverts that local state. No optimistic value is ever
  the value that gets written to the database.
- **The pure domain layer has zero framework or database imports**
  (`lib/domain/money.ts`, `splits.ts`, `balances.ts`, `debt-simplify.ts`,
  `recurring.ts`) — enforced by an ESLint boundary rule, not just convention.
  This is a scaling property for the _codebase_, not the runtime: that layer
  can be unit-tested in milliseconds with no server running, and it could be
  extracted into a separate package or even a different runtime (an edge
  function, a mobile client) without carrying a database client with it.

---

## 8. Current architectural limitations

Named plainly, because pretending a version-one product has none is a worse
answer than naming them accurately:

1. **`get_household_balances` (§3.1) recomputes the full history on every
   call.** Fine at hundreds of expenses per household; the first thing that
   would need to change for a household with tens of thousands.
2. **No caching layer.** Every page load re-queries Postgres, including data
   that changes rarely (a household's name, its member list, its category
   list). There is no Redis, no HTTP cache header on any dynamic route
   (deliberately — see the export route's `Cache-Control: private, no-store`,
   which is _correct_ for personal financial data, not an oversight), and no
   `unstable_cache`/`revalidate` layer in front of Supabase reads.
3. **The recurring-expense cron is a single, unpaginated sweep** (§3.4) of
   every due rule on the platform, run once daily on Vercel's Hobby-tier
   schedule limit. It has no batching or backoff if the due set were ever
   large enough to risk the route's execution time limit.
4. **No CDN/edge caching for HTML.** Every page is a fresh server render.
   Acceptable for a product whose every page shows a specific household's
   private, live-changing ledger — there is close to nothing on this product
   that a shared cache could safely serve to a second user anyway — but it is
   a real limitation if a future public/marketing surface were added.
5. **Realtime fan-out is per-table, not sharded.** Supabase's Realtime relies
   on Postgres logical replication; all `shopping_items` and `notifications`
   changes flow through one replication slot. This project's traffic is far
   below where that becomes a constraint, but it is a platform-level ceiling
   this architecture does not control.
6. **Single-region database.** The Supabase project runs from one region.
   Households whose members are geographically distant all pay the same
   round-trip latency to that region; there is no read-replica or
   multi-region strategy.

---

## 9. What would change at real scale

In the order they would actually need to happen, cheapest and most localized
first:

1. **Cache `get_household_balances` and the insights aggregates**, invalidated
   on write (a new expense, a settlement, a void). Since balances are
   intentionally never _stored_ as ledger truth, this would be a read-through
   cache (Redis, or Next.js's own data cache with tag-based revalidation) —
   the derivation logic in the SQL function would not change, only how often
   it actually runs.
2. **Materialize a running balance per household**, updated incrementally by
   a trigger on `expenses`/`expense_splits`/`settlements` writes, once a
   household's history is large enough that recomputing it becomes
   measurable. This trades the current "cannot drift by construction"
   guarantee for a "verified consistent by a periodic reconciliation job"
   guarantee — a real trade-off, not a pure improvement, which is why it is
   not the default today.
3. **Batch the recurring-expense cron** with a `LIMIT`/cursor over due rules
   and multiple invocations, if the due set ever approached Vercel's function
   duration limit — the same cursor-pagination pattern already used for the
   expense ledger, applied to a different table.
4. **Add a CDN/edge cache in front of genuinely public, non-personal
   responses** if the product grew a public surface (a landing page, public
   household invitation preview) — none of the current authenticated pages
   are candidates for this by design.
5. **Move to Postgres read replicas** if read load ever separated
   meaningfully from write load — not a change this product's access pattern
   (small households, bursty rather than constant traffic) currently needs or
   would benefit from.

None of these are implemented today, because none of them are needed today —
adding a cache invalidation strategy for a query that runs in single-digit
milliseconds against a few thousand rows would be complexity spent on a
problem the product does not have yet, at the cost of correctness guarantees
(§9.2's trade-off) the product currently gets for free.
