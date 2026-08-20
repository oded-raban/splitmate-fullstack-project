/**
 * Security primitives shared across server-only entry points.
 * =============================================================================
 * Not `lib/domain/`: these are not business rules, they are defensive plumbing,
 * and `lib/domain` is reserved for the money/split/balance logic that the
 * project's coverage gate specifically targets. This module has no such gate,
 * but it is still pure and framework-free — `node:crypto` is a runtime
 * primitive, not an application dependency — so it is just as testable.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time bearer token check, for the one route in this application
 * (`app/api/cron/recurring/route.ts`) that authenticates a request with a
 * shared secret instead of a Supabase session.
 *
 * `===` on strings returns as soon as two bytes differ, so the time a rejection
 * takes reveals how many leading characters were correct — enough to recover
 * the secret one byte at a time over enough requests. `timingSafeEqual`
 * compares the whole buffer regardless of where it first differs.
 *
 * `timingSafeEqual` throws on a length mismatch rather than returning `false`,
 * so the lengths are compared first. That comparison is not itself a timing
 * leak worth closing: the length of a shared secret is not sensitive, only its
 * content is, and Node's own API does not offer a variable-length constant-time
 * comparison to use instead.
 */
export function isAuthorizedBearerToken(
  header: string | null | undefined,
  secret: string,
): boolean {
  if (!header?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);

  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

/**
 * Whether `pathname` is `prefix` itself, or a path segment under it.
 *
 * Exists because the obvious one-liner, `pathname.startsWith(prefix)`, is
 * wrong: it treats `/apple-icon` as being under `/app`, because the
 * *string* `/app` is a prefix of the *string* `/apple-icon`, even though
 * `/apple-icon` is not a path segment under `/app` at all. That is not a
 * hypothetical — it silently redirected the PWA's home-screen icon
 * (`app/apple-icon.tsx`) to `/login` in `lib/supabase/proxy.ts`'s route
 * protection, breaking "Add to Home Screen" on iOS, until this function
 * replaced the prefix check everywhere route matching happens by string
 * prefix rather than by path segment.
 */
export function isUnderPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
