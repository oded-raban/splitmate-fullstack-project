# SplitMate — Software Architecture Design

| Field        | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| Document     | Architecture Design                                                            |
| Version      | 1.0                                                                            |
| Related docs | [PRD](./01-product-requirements.md) · [Technical Spec](./03-technical-spec.md) |

This document answers the core architecture questions explicitly: what components compose the system, whether there is a database and what lives in it, what pages exist, what API routes and Server Actions are needed, how data flows between frontend, backend and database, what user types and permissions exist, and which external services we integrate and why.

---

## 1. System Context

```
┌──────────────────────────────────────────────────────────────────────┐
│                              Browser                                  │
│  React Server Component payloads · Client islands · Realtime socket   │
└───────────────┬───────────────────────────────────┬──────────────────┘
                │ HTTPS                             │ WSS (Realtime)
                ▼                                   │
┌──────────────────────────────────────────────┐    │
│          Proxy layer (Vercel, Node)           │    │
│  proxy.ts — refresh session cookies,          │    │
│  guard /app/* routes, apply security headers  │    │
└───────────────┬──────────────────────────────┘    │
                ▼                                   │
┌──────────────────────────────────────────────┐    │
│         Next.js Server (Vercel, Node)         │    │
│  • Server Components  — all reads             │    │
│  • Server Actions     — all writes            │    │
│  • Route Handlers     — cron, CSV, OAuth cb   │    │
│  • Domain layer       — pure TypeScript       │    │
└───────────────┬──────────────────────────────┘    │
                │ postgrest / supabase-js            │
                │ (always with the CALLER's JWT)     │
                ▼                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                              Supabase                                 │
│  Postgres + RLS  ·  Auth (GoTrue)  ·  Storage  ·  Realtime  ·  pg_cron│
└──────────────────────────────────────────────────────────────────────┘
                                │
                     ┌──────────┴──────────┐
                     ▼                     ▼
              Resend (email)        Sentry (errors)
```

### The single most important architectural decision

**Authorization lives in the database, not in the application.** Every query the Next.js server issues on behalf of a user is executed with that user's JWT, so PostgreSQL Row-Level Security evaluates every row. The application layer _also_ checks permissions — for good error messages and early rejection — but it is not the boundary.

The consequence: a forgotten `where household_id = ?` in application code returns **zero rows** instead of leaking another household's finances. The service-role key, which bypasses RLS, exists only in the scheduled-job route handler and never reaches a user-facing request path.

---

## 2. Components

### 2.1 Client (browser)

Mostly server-rendered HTML with React Server Component payloads. Client components ("islands") exist only where interactivity demands them: expense forms with live split preview, the realtime shopping list, chart rendering, dialogs and menus, and the notification bell.

The client holds one direct connection to Supabase that bypasses the Next.js server: the **Realtime WebSocket** for the shopping list. This is deliberate — proxying a WebSocket through serverless functions would be both expensive and fragile — and it is safe because Realtime authorizes subscriptions through the same RLS policies as ordinary queries.

### 2.2 Proxy layer (`proxy.ts`)

Runs before every matched request. It refreshes the Supabase session cookie (tokens are short-lived; without refresh, users are silently logged out mid-session), redirects unauthenticated requests for `/app/*` to login while preserving the intended destination, redirects authenticated users away from the login page, and attaches security headers including a Content Security Policy.

> **Version note.** Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`, with the exported function named `proxy`. It now runs exclusively on the **Node.js runtime** — the edge runtime is not supported for this file. Everything written about "middleware" in older Next.js material applies here under the new name.

This layer performs **no data authorization**. It is a UX and hygiene layer; treating it as a security boundary is a common and serious mistake, since a request that reaches a Server Action directly never passes through it. The Next.js documentation makes the same point explicitly: the proxy is for optimistic checks, not for session management or authorization.

### 2.3 Application server (Next.js)

Four distinct responsibilities, kept in separate directories:

**Server Components** perform all reads. They call the data-access layer directly — no HTTP hop, no serialization of a REST response into a client cache. A page component awaits its queries and streams HTML.

**Server Actions** perform all writes. Each action follows an identical, auditable pipeline (§4.2). They are the application's write API and they replace what would traditionally be `POST /api/...` endpoints.

**Route Handlers** exist only where a Server Action cannot be used: the OAuth callback (`/auth/callback`), the daily cron job (`/api/cron/recurring`), and CSV export (`/api/households/[householdId]/export`, which streams a file rather than returning React).

**The domain layer** is framework-free, dependency-free TypeScript: money arithmetic, the four split algorithms, balance derivation, and debt simplification. It imports nothing from Next.js or Supabase, which is precisely why it can be unit-tested exhaustively in milliseconds. **This is the part of the codebase that must be provably correct.**

### 2.4 Data platform (Supabase)

| Service                   | Role                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Postgres**              | System of record; also hosts business logic that belongs near the data (balance derivation, analytics aggregation, atomic multi-table writes) |
| **Auth (GoTrue)**         | Magic-link and Google OAuth; issues the JWTs that RLS reads                                                                                   |
| **Storage**               | Private bucket for receipt images, governed by storage RLS policies                                                                           |
| **Realtime**              | Postgres change streams over WebSocket for the shopping list                                                                                  |
| **pg_cron / Vercel Cron** | Daily trigger for recurring expense generation                                                                                                |

---

## 3. Is there a database, and what is in it?

Yes — a single PostgreSQL database, chosen over any document store because the domain is intrinsically relational and financially strict. We need multi-row transactions (an expense and its splits must be written atomically or not at all), referential integrity (a split cannot reference a non-member), check constraints and triggers (splits must sum to the total), and set-based aggregation (balances and analytics are joins and sums, not per-document scans). A relational database gives all of that as a guarantee rather than as application discipline.

### Entities

```
profiles ──┬──< household_members >── households ──┬──< invitations
           │                                        ├──< categories
           ├──< expenses (payer) ───┬──< expense_splits >── profiles
           │                        └──< expense_revisions
           ├──< settlements (from/to) ──────────────┤
           ├──< shopping_lists ──< shopping_items ──┤
           ├──< recurring_expenses ─────────────────┤
           ├──< notifications ──────────────────────┤
           └──< activity_log ───────────────────────┘
```

**Core (the ledger):** `profiles`, `households`, `household_members`, `expenses`, `expense_splits`, `settlements`.
**Governance:** `invitations`, `expense_revisions`, `activity_log`.
**Feature support:** `categories`, `shopping_lists`, `shopping_items`, `recurring_expenses`, `notifications`.

**There is no `balances` table.** Balances are derived from the ledger by a SQL function. A stored balance is a cache, and a cache of financial truth is a bug waiting to happen: every write path would have to update it correctly forever, and a single missed update produces a permanently wrong number that no one can explain. Deriving costs a sum over a household's rows — trivially fast at household scale, and indexed for it.

Full column-level DDL, constraints, indexes and RLS policies live in the [Technical Spec §3](./03-technical-spec.md).

---

## 4. Data Flow

### 4.1 Read path

```
Request → middleware (refresh session)
        → Server Component
        → createServerClient()  [reads session from cookies]
        → supabase.from(...).select(...)  /  supabase.rpc(...)
        → Postgres evaluates RLS with auth.uid()
        → rows → React renders on the server → HTML streamed to browser
```

No client-side fetch, no loading spinner for initial data, no API contract to keep in sync, and no risk of over-fetching to satisfy a generic endpoint. Each page requests exactly the columns it renders.

### 4.2 Write path

Every Server Action executes the same seven steps, in this order:

1. **Authenticate** — `supabase.auth.getUser()`, which _verifies the JWT with the auth server_ rather than trusting the cookie's contents. (`getSession()` does not verify and must never be used for authorization.)
2. **Validate** — parse raw input with a Zod schema. The server never trusts client-side validation; the client-side pass exists purely for fast feedback.
3. **Authorize** — check household membership and role for the requested operation, producing a clear error before touching data.
4. **Compute** — run the pure domain functions (split allocation, rounding) on validated input.
5. **Persist** — a single call, wrapped in a transaction. Multi-table writes go through a Postgres function so that partial writes are impossible.
6. **Record** — append to `activity_log` and enqueue notifications, inside the same transaction.
7. **Revalidate** — `revalidatePath()` the affected routes and return a typed result.

The client receives a discriminated-union result (`{ ok: true, data }` or `{ ok: false, error }`) and never sees a raw exception or a database error string.

### 4.3 Realtime path

```
Client subscribes to channel `household:{id}:shopping`
  → Supabase Realtime authorizes the subscription against RLS
  → Any INSERT/UPDATE/DELETE on shopping_items in that household
  → broadcast to all subscribed clients
  → client reducer merges the event into local state
```

Writes still go through Server Actions — the client never writes directly. Realtime is a **read-side notification channel only**. A local optimistic update is applied immediately, then reconciled by the authoritative event when it arrives (or rolled back with a visible toast if the action fails).

### 4.4 Scheduled path

```
Vercel Cron (daily 06:00 Asia/Jerusalem)
  → GET /api/cron/recurring with a secret header
  → handler verifies the secret in constant time, else 401
  → service-role client selects rules where next_run_at <= today
  → for each rule: validate members still exist → create expense + splits
                   → notify members → advance next_run_at
  → idempotency guard prevents a double run creating duplicates
```

This is the only place the service-role key is used, because the job acts as the system rather than as any user.

---

## 5. Pages

Route groups keep authenticated and public surfaces cleanly separated, each with its own layout.

| Route                                       | Rendering            | Auth                   | Purpose                                                      |
| ------------------------------------------- | -------------------- | ---------------------- | ------------------------------------------------------------ |
| `/`                                         | Static               | Public                 | Landing page: problem, product, call to action               |
| `/privacy`, `/terms`                        | Static               | Public                 | Privacy policy and terms of service                          |
| `/login`                                    | Static + client form | Public                 | Magic link and Google sign-in                                |
| `/auth/callback`                            | Route handler        | Public                 | Exchanges the auth code for a session                        |
| `/onboarding`                               | Dynamic              | Required               | First-run: create or join a household                        |
| `/app`                                      | Dynamic              | Required               | Cross-household dashboard: total owed/owing, recent activity |
| `/app/households/[id]`                      | Dynamic              | Member                 | Household home: balances, recent expenses, quick add         |
| `/app/households/[id]/expenses`             | Dynamic              | Member                 | Filterable, paginated ledger                                 |
| `/app/households/[id]/expenses/new`         | Dynamic              | Member                 | Create expense with live split preview                       |
| `/app/households/[id]/expenses/[expenseId]` | Dynamic              | Member                 | Detail: splits, receipt, revision history                    |
| `/app/households/[id]/settle`               | Dynamic              | Member                 | Simplified transfers + record a payment                      |
| `/app/households/[id]/shopping`             | Dynamic + realtime   | Member                 | Live shared list, checkout to expense                        |
| `/app/households/[id]/insights`             | Dynamic              | Member                 | Analytics dashboard                                          |
| `/app/households/[id]/recurring`            | Dynamic              | Admin                  | Recurring rules                                              |
| `/app/households/[id]/members`              | Dynamic              | Member (manage: Admin) | Members, roles, invitations                                  |
| `/app/households/[id]/settings`             | Dynamic              | Admin                  | Name, categories, danger zone                                |
| `/app/households/[id]/activity`             | Dynamic              | Member                 | Full audit trail                                             |
| `/app/invite/[token]`                       | Dynamic              | Required               | Invitation preview and acceptance                            |
| `/app/notifications`                        | Dynamic              | Required               | Notification centre                                          |
| `/app/settings`                             | Dynamic              | Required               | Profile and preferences                                      |

Every dynamic page has a colocated `loading.tsx` (skeleton via Suspense) and `error.tsx` (recoverable error boundary), plus `not-found.tsx` where a bad ID is plausible.

---

## 6. Server Actions & Route Handlers

Grouped by aggregate. Full signatures, input schemas and error codes are in the [Technical Spec §5](./03-technical-spec.md).

**Households:** create, update, archive, leave, transfer ownership.
**Members & invitations:** create invitation, revoke invitation, accept invitation, change role, remove member.
**Expenses:** create, update, soft-delete, restore, attach receipt, get signed receipt URL.
**Settlements:** create, void.
**Shopping:** add item, update item, toggle checked, delete item, checkout to expense.
**Recurring:** create rule, update rule, toggle active, delete rule.
**Categories:** create, update, delete (with reassignment of affected expenses).
**Notifications:** mark read, mark all read.
**Profile:** update display name and avatar.

**Route handlers:** `GET /auth/callback` (OAuth/magic-link code exchange), `GET /api/cron/recurring` (scheduled generation, secret-guarded), `GET /api/households/[householdId]/export` (CSV stream, membership-checked).

### Why Server Actions instead of REST endpoints

The alternative — a `/api/*` REST layer consumed by client-side fetches — would add a hand-maintained HTTP contract, duplicate type definitions on both sides, and a client-side cache to invalidate, all to serve a client that is already colocated with the server. Server Actions give end-to-end type safety across the network boundary, automatic CSRF protection, progressive enhancement (forms work before hydration), and cache revalidation as a first-class primitive.

The trade-off, stated honestly for the presentation: Server Actions are **not a public API**. If SplitMate ever needed a mobile client or third-party integrations, we would expose a REST or GraphQL layer over the same domain functions. Because all business logic lives in `lib/domain` and Postgres functions rather than inside the actions, that addition is additive rather than a rewrite.

---

## 7. Users, Roles & Permissions

**Three user types** exist relative to a household: **Owner** (exactly one; full control including deletion and role changes), **Admin** (day-to-day management: invite, remove, manage recurring rules and categories, edit any expense), and **Member** (log expenses, participate in splits, settle their own debts, read everything). A single account may hold different roles in different households simultaneously.

Beyond household roles there is **anonymous** (marketing and auth pages only) and **authenticated-without-household** (may only create or join a household — a state the onboarding flow exists to resolve).

Enforcement is layered, and each layer has a distinct job:

| Layer              | Enforces                                           | If it fails                    |
| ------------------ | -------------------------------------------------- | ------------------------------ |
| Proxy (`proxy.ts`) | Is there a session?                                | Redirect to login              |
| Server Action      | Membership + role for this operation               | Typed error, clear message     |
| **RLS policy**     | **Row-level access, always**                       | **Zero rows / write rejected** |
| DB constraints     | Domain invariants (splits sum, no self-settlement) | Transaction aborted            |

The permission matrix itself is in [PRD §8.1](./01-product-requirements.md#81-roles--permissions); the SQL policies that implement it are in [Technical Spec §4](./03-technical-spec.md).

---

## 8. External Libraries & Services — and why

| Choice                    | Purpose                                    | Why this, and what we rejected                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Next.js (App Router)**  | Full-stack React framework                 | Chosen as the foundation. The App Router specifically gives Server Components (no client fetch for reads) and Server Actions (typed writes), which shape the whole architecture.                                                                                                                |
| **TypeScript (strict)**   | Type safety                                | Database types are _generated_ from the schema, so a migration that renames a column breaks the build rather than production.                                                                                                                                                                   |
| **Supabase**              | Postgres, Auth, Storage, Realtime          | Required. Choosing it as one integrated platform avoids stitching together four vendors, and RLS lets authorization live with the data.                                                                                                                                                         |
| **@supabase/ssr**         | Cookie-based sessions across server/client | The only correct way to share an auth session between Server Components, Server Actions and the browser client.                                                                                                                                                                                 |
| **Tailwind CSS**          | Styling                                    | Colocated styles, no naming overhead, a design system by constraint. Rejected CSS Modules (verbose at this scale) and a component library with baked-in styling (harder to make it feel bespoke).                                                                                               |
| **shadcn/ui + Radix**     | Accessible UI primitives                   | Source is copied into the repo, so it is _our_ code and fully customisable. Radix supplies correct keyboard interaction and ARIA for dialogs, menus and popovers — accessibility that is genuinely hard to write from scratch. Rejected MUI/Chakra as heavy and hard to differentiate visually. |
| **Zod**                   | Runtime validation                         | One schema definition yields both the runtime guard and the static TypeScript type, used identically on client and server. Without it, "validated" input is only a compile-time fiction.                                                                                                        |
| **react-hook-form**       | Form state                                 | Uncontrolled inputs mean typing doesn't re-render the form — noticeable on the split editor with many participant rows. Integrates with Zod through a resolver.                                                                                                                                 |
| **Recharts**              | Charts                                     | Declarative React components, responsive, small enough for our four chart types. Rejected D3 (far more power than needed) and Chart.js (imperative, canvas-based, awkward in React).                                                                                                            |
| **date-fns**              | Dates                                      | Tree-shakeable pure functions; only the handful we use ship. Rejected Moment (large, mutable, deprecated).                                                                                                                                                                                      |
| **Resend + React Email**  | Transactional email                        | Emails authored as React components, so invitation emails share styling with the app. Only used for invites and reminders.                                                                                                                                                                      |
| **Vitest**                | Unit/integration tests                     | Same transform pipeline as the app, extremely fast, Jest-compatible API.                                                                                                                                                                                                                        |
| **React Testing Library** | Component tests                            | Tests behaviour through the accessibility tree rather than implementation details.                                                                                                                                                                                                              |
| **Playwright**            | End-to-end tests                           | Real browsers, and critically **multiple isolated browser contexts in one test** — the only practical way to test two roommates interacting live.                                                                                                                                               |
| **Sentry**                | Error monitoring                           | Production errors are invisible otherwise. Source-mapped stack traces with user and household context.                                                                                                                                                                                          |
| **Vercel**                | Hosting                                    | Required. Preview deployment per pull request, the proxy layer, and managed cron scheduling.                                                                                                                                                                                                    |

Every dependency above is justified by a capability we would otherwise have to build. Anything that only saves typing was rejected — dependency count is a maintenance and security cost.

---

## 9. Environments

| Environment | Frontend              | Database                                     | Purpose                          |
| ----------- | --------------------- | -------------------------------------------- | -------------------------------- |
| Local       | `next dev`            | The one hosted Supabase project (note below) | Development                      |
| Preview     | Vercel preview per PR | The one hosted Supabase project (note below) | Review and E2E runs before merge |
| Production  | Vercel production     | The one hosted Supabase project (note below) | Live users                       |

**Note on the database column:** the Supabase CLI's local stack (Docker plus
a local Postgres) was deliberately not used for this project — Docker is not
installed on the development machine — so local development, preview
deployments and production all currently point at the same hosted Supabase
project rather than three isolated database instances. `docs/README.md`'s
"Environment Status" section spells out the practical consequences (how
migrations are applied without the CLI's local runner, why `npm run db:check`
exists as a safety net, and why `supabase/seed.sql` — which creates auth
users with a known password — is never run against it). Splitting this into
per-environment projects later is a mechanical, low-risk change, since every
schema change already lives as versioned SQL rather than dashboard edits.

Schema changes are **only ever** applied as versioned SQL migration files in `supabase/migrations/`, committed to git, and applied via CI. Nobody edits production schema through a dashboard — that path produces environments that silently diverge and a schema with no history.

---

## 10. Cross-Cutting Concerns

**Error handling.** Three tiers: expected domain failures return typed results rendered inline (e.g. "Splits must sum to ₪250.00, currently ₪249.00"); unexpected server errors are caught by route `error.tsx` boundaries, logged to Sentry with a correlation ID, and shown as a recoverable message; database constraint violations are mapped from Postgres error codes to human sentences. Raw errors are never surfaced to users, because they leak schema details.

**Configuration.** All configuration comes from environment variables, parsed and validated by a Zod schema at startup so a missing variable fails the build rather than the first request. Only variables prefixed `NEXT_PUBLIC_` reach the browser, and the anon key is deliberately among them — it is safe precisely because RLS constrains it.

**Observability.** Sentry for exceptions, Vercel Analytics for traffic and Web Vitals, structured server-side logs with a request ID, and Supabase's query performance dashboard for slow queries. Amounts and personal data are scrubbed from logs.

**Performance.** Static rendering for marketing pages; per-page server data fetching with parallel awaits; `next/image` for avatars and receipts; route-level code splitting with charts loaded lazily; database aggregation instead of shipping raw rows to Node; cursor-based pagination on the expense ledger.

---

## 11. Key Architectural Decisions

Recorded ADR-style, since every non-obvious technical decision should be traceable to a stated reason and a considered alternative.

**ADR-1 — RLS as the authorization boundary.** _Alternative:_ enforce access only in application code. _Chosen because_ application checks are opt-in and one forgotten filter leaks data, whereas RLS is default-deny and applies to every path including Realtime and Storage. _Cost:_ policies are harder to debug and can recurse; mitigated with `SECURITY DEFINER` helper functions and a dedicated test suite that queries as two real users.

**ADR-2 — Derive balances, never store them.** _Alternative:_ a `balances` table updated on every write. _Chosen because_ derived values cannot drift, and correctness matters more than microseconds at household scale. _Cost:_ recomputation per view; mitigated by computing in SQL with covering indexes, with a materialized view available if a household ever grew large enough to need it.

**ADR-3 — Integer minor units for all money.** _Alternative:_ floating point or `numeric`. _Chosen because_ binary floats cannot represent 0.1 exactly and errors compound across splits; integers make every operation exact and every test deterministic. _Cost:_ explicit formatting at the display boundary — a single well-tested module.

**ADR-4 — Server-first data flow with no client data-fetching library.** _Alternative:_ TanStack Query over REST routes. _Chosen because_ Server Components remove the need for a client cache entirely for the 90% of the app that is read-render-mutate-revalidate, eliminating a whole category of stale-cache bugs and a large client bundle. _Cost:_ interactive surfaces need bespoke optimistic handling; accepted because only the shopping list truly needs it.

**ADR-5 — Multi-table writes inside Postgres functions.** _Alternative:_ sequential `insert` calls from Node. _Chosen because_ an expense without its splits is corrupt data, and PostgREST cannot span multiple statements in one transaction. _Cost:_ business logic split across TypeScript and SQL; mitigated by keeping _decisions_ in TypeScript and only _atomic persistence_ in SQL.

**ADR-6 — Soft deletes and an append-only audit log.** _Alternative:_ hard deletes. _Chosen because_ the product's core value is trust, and a member must be able to see that an expense existed and was removed by whom. _Cost:_ every query must filter `deleted_at is null`; enforced through a shared data-access layer and partial indexes.
