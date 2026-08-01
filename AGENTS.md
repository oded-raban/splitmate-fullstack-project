<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SplitMate — engineering conventions

Collaborative expense management for shared households.
Full design documents live in `docs/`. Read `docs/03-technical-spec.md` before implementing anything.

## Next.js 16 specifics (differs from older training data)

- **`middleware.ts` no longer exists.** The convention is `proxy.ts` at the project root, exporting a function named `proxy`. It runs on the **Node.js runtime**; the edge runtime is not supported there.
- **Request APIs are async-only.** `cookies()`, `headers()`, `draftMode()`, and the `params` / `searchParams` props of pages, layouts and route handlers are all Promises and must be awaited. Synchronous access was removed in v16.
- **Turbopack is the default** for `next dev` and `next build`; no `--turbopack` flag is needed.
- **`next lint` was removed.** Linting runs through the ESLint CLI (`npm run lint`), and `next build` no longer lints.
- **`revalidateTag(tag)` now requires a cache-life profile** as a second argument. For read-your-writes semantics inside a Server Action, prefer `updateTag(tag)`. `refresh()` refreshes the client router from an action.
- Use the generated `PageProps<'/route'>` / `LayoutProps<'/route'>` / `RouteContext<'/route'>` helpers for typed route props.

## Non-negotiable rules

1. **Money is always integer minor units** (`bigint` in Postgres, branded `Minor` in TypeScript). Never floats, never `parseFloat` on a money string outside `lib/domain/money.ts`.
2. **`lib/domain/**` stays pure.** No imports from React, Next.js, Supabase, or anything in `lib/data`, `lib/actions`, `components`. Enforced by ESLint. This is what makes the financial logic exhaustively testable.
3. **Never use `supabase.auth.getSession()` for authorization.** It reads the cookie without verifying it. Use `getUser()`, which verifies the JWT with the auth server.
4. **`lib/supabase/admin.ts` (service role) bypasses RLS.** It may be imported only by the cron route handler. Enforced by ESLint.
5. **Every table has RLS enabled with no permissive fallback.** Application-level permission checks exist for good error messages; RLS is the actual boundary.
6. **Every Server Action follows the same pipeline:** authenticate → validate with Zod → authorize → compute with domain functions → persist (transactionally) → log activity → revalidate. Actions return `ActionResult<T>`; they do not throw across the network boundary.
7. **Validate on the server even when the client already validated.** Client validation is UX only.
8. **Soft-delete financial records.** Never hard-delete an expense or settlement; the audit trail is a product feature.
9. **Cursor-based pagination**, never `OFFSET`, for the expense ledger and activity feed.

## Code style

- Comment _why_, not _what_. Every module gets a header docstring explaining its purpose and any non-obvious design decision; complex algorithms get inline explanation of the reasoning.
- Prefer Server Components. Add `'use client'` only for state, effects, browser APIs or event handlers, and push it as far down the tree as possible.
- Type-only imports use `import type`.
- Run `npm run verify` (typecheck + lint + tests) before considering a change done.

## Commands

| Command                    | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `npm run dev`              | Development server                                          |
| `npm run verify`           | Typecheck, lint, and unit/component tests                   |
| `npm test`                 | Unit + component tests                                      |
| `npm run test:integration` | RLS / database tests (needs a running database)             |
| `npm run test:e2e`         | Playwright end-to-end tests                                 |
| `npm run db:start`         | Start local Supabase                                        |
| `npm run db:reset`         | Re-apply all migrations + seed from scratch                 |
| `npm run db:types`         | Regenerate `lib/supabase/database.types.ts` from the schema |
