# SplitMate

**Collaborative expense management for shared households.**

Roommates split rent, bills and groceries constantly, and settle up badly. The
running total lives in someone's head or a spreadsheet nobody trusts, so the
conversation about money happens later than it should and with worse information
than it needs. SplitMate keeps the ledger instead: anyone can record a shared
expense in a few seconds, everyone sees an up-to-date balance, and settling up
becomes the shortest list of payments that clears the debt.

|                      |                                                                               |
| -------------------- | ----------------------------------------------------------------------------- |
| **Live application** | https://splitmate-khaki.vercel.app                                            |
| **Repository**       | https://github.com/oded-raban/splitmate-fullstack-project                     |
| **Documentation**    | [`docs/`](./docs/README.md) — PRD, architecture, technical spec, and the rest |

---

## Stack

| Layer      | Choice                              | Why this one                                                                                                                                             |
| ---------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework  | Next.js 16 (App Router)             | Server Components let the ledger be queried on the server and rendered as HTML, so the browser never receives a database client or another member's data |
| Language   | TypeScript, `strict`                | Money handling is the kind of code where a silent `undefined` becomes a wrong number rather than a crash                                                 |
| Database   | Supabase (Postgres)                 | Row-Level Security puts the authorization boundary in the database, so a bug in a page cannot leak a household's expenses                                |
| Auth       | Supabase Auth — magic link + Google | No password to store, reset, or leak                                                                                                                     |
| UI         | Tailwind CSS + shadcn/ui (Radix)    | Accessible primitives, styled in-repo rather than imported as an opaque theme                                                                            |
| Validation | Zod                                 | One schema validates the form and the Server Action, so client and server cannot disagree about what is valid                                            |
| Tests      | Vitest, Testing Library, Playwright | Unit tests for the money algorithms, end-to-end tests for the workflows                                                                                  |
| Hosting    | Vercel                              | Same platform as the framework; every push gets a preview deployment                                                                                     |

---

## Running it locally

### Prerequisites

Node.js 20 or newer, npm, and a Supabase project. Docker is **not** required —
this project talks to a hosted Supabase instance rather than a local container.

### Setup

```bash
git clone https://github.com/oded-raban/splitmate-fullstack-project.git
cd splitmate-fullstack-project
npm install
cp .env.example .env.local     # then fill in the values below
npm run db:push                # apply migrations to your Supabase project
npm run db:types               # generate TypeScript types from the live schema
npm run dev
```

Open http://localhost:3000.

One piece of configuration lives outside this repository: in the Supabase
dashboard, under **Authentication → URL Configuration**, the redirect allow-list
must contain `http://localhost:3000/auth/callback`. Supabase refuses to return a
session to any origin not on that list, which is precisely what stops someone
appending their own address to a sign-in link.

### Environment variables

Copy `.env.example` to `.env.local`. Nothing has a default: the app validates
every variable at startup (`lib/env.ts`) and refuses to boot with a clear message
naming the offender, rather than failing later inside a request.

| Variable                        | Scope      | What it is                                                                                                                                       |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | public     | Your Supabase project URL                                                                                                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public     | Anonymous key. Safe in the browser **only** because RLS is enabled on every table — it identifies the project and grants nothing by itself       |
| `NEXT_PUBLIC_SITE_URL`          | public     | Origin used to build auth redirects and invitation links. Optional on Vercel, where it is derived from the deployment URL                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | **secret** | Bypasses RLS entirely. Used only by the scheduled job, which acts as the system rather than as a user. Leaking it compromises the whole database |
| `CRON_SECRET`                   | **secret** | Shared secret proving a request to the cron endpoint came from Vercel                                                                            |
| `SUPABASE_DB_URL`               | tooling    | Direct Postgres connection, used by `npm run db:push`                                                                                            |
| `SUPABASE_PROJECT_REF`          | tooling    | Project ref, used by `npm run db:types`                                                                                                          |
| `SUPABASE_ACCESS_TOKEN`         | tooling    | Personal access token, used by `npm run db:types`                                                                                                |
| `RESEND_API_KEY`, `EMAIL_FROM`  | optional   | Transactional email. Omit them and invitation links are logged to the console instead of sent                                                    |

Only the `NEXT_PUBLIC_*` variables reach the browser. The rest are read through
`serverEnv()`, which throws if it is ever called during a client render — turning
an accidental import into a loud failure instead of a silent leak.

### Sample data

```bash
node scripts/dev-user.mjs seed          # a household, three members, four expenses, one settlement
node scripts/dev-user.mjs login maya    # prints a one-time sign-in link
node scripts/dev-user.mjs cleanup       # removes every test account
```

The seed signs in as real users and goes through the same RPCs the application
uses, rather than inserting rows directly. That is slower, and deliberate: a
direct insert would bypass the deferred trigger that proves an expense's splits
sum to its total, so the fixture would not be evidence that the write path works.

---

## Commands

| Command                    | Does                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`              | Development server                                                           |
| `npm run ship`             | Everything CI checks, plus a production build. Run before pushing            |
| `npm run verify`           | Types, lint, formatting, unit and component tests                            |
| `npm run test`             | Unit and component tests                                                     |
| `npm run test:integration` | RLS/RPC suite against the live Supabase project (see docs/04-test-plan.md)   |
| `npm run test:e2e`         | Playwright end-to-end tests                                                  |
| `npm run db:sync`          | Apply migrations, regenerate types, verify the deployed schema               |
| `npm run db:check`         | Assert the live database exposes every table, policy and RPC the app expects |
| `npm run db:realtime`      | Assert `shopping_items` and `notifications` are actually streaming           |

`db:check` exists because `db push` reporting success only proves the SQL
executed. It confirms PostgREST can actually see every table, that RLS denies
an anonymous caller, and that every business function is exposed.

`db:realtime` exists for a narrower reason: publication membership is not part
of a table's definition, so a missing `ALTER PUBLICATION ... ADD TABLE` produces
no error anywhere. `subscribe()` still reports `SUBSCRIBED`; events simply never
arrive. The symptom is a "live" shopping list that silently is not — this script
is what catches that before a user does.

---

## How it is put together

```
app/                 Routes. (auth) is unauthenticated, app/ requires a session
components/          UI. Server Components by default; "use client" is the exception
lib/
  domain/            Pure TypeScript: money, splits, balances, debt simplification.
                     No framework or database imports — enforced by an ESLint rule
  actions/           Server Actions: the only way the client writes anything
  data/              Cached read queries for Server Components
  supabase/          Client factories: server, browser, service-role, proxy
supabase/migrations/ Schema, triggers, RLS policies, RPCs
tests/               Unit, component, integration and end-to-end suites
```

Four decisions shape most of the code, and each is argued in full in
[`docs/`](./docs/README.md):

**Money is stored as integer minor units.** Floating point cannot represent 0.1
exactly, and across repeated splits that error compounds into a balance that is
visibly wrong.

**Balances are derived, never stored.** A cached financial figure can drift out
of agreement with the ledger it summarises. A derived one cannot.

**Splits must sum to the total, enforced by a deferred database trigger.** Not by
application code that could be bypassed — the database structurally cannot hold a
corrupt expense.

**Row-Level Security is the authorization boundary.** Checks in the application
exist to produce good error messages. RLS is what actually prevents one household
from reading another's ledger.

---

## Status

Authentication, households, the expense ledger, balances, settling up, and all
of Tier 1 — the realtime shopping list, receipt uploads, spending insights,
notification bell, CSV export, and recurring-expense automation — are complete
and deployed. Test plan, scalability, security and the code map are in
progress. See the [roadmap](./docs/README.md#roadmap).
