/**
 * Session refresh for the proxy layer.
 * =============================================================================
 * Supabase access tokens are deliberately short-lived (one hour). Something has
 * to exchange the refresh token for a new access token before the old one
 * expires, and write the result back as cookies.
 *
 * A Server Component cannot do it: by the time one renders, the response headers
 * are already being streamed, so any `Set-Cookie` it produces is discarded. That
 * is precisely why `lib/supabase/server.ts` swallows the error from `setAll` —
 * it relies on this module having already refreshed the tokens.
 *
 * So the refresh happens here, in the proxy, on every matched request, before
 * any rendering starts. Without it a user is silently signed out an hour into
 * their session, which is both baffling and — because it looks like data loss
 * while filling in a form — genuinely damaging.
 *
 * SECURITY BOUNDARY — READ THIS BEFORE ADDING ANYTHING
 * The redirect below is a UX affordance, NOT an authorization check. A request
 * that reaches a Server Action directly never passes through this file. The
 * real boundary is Row Level Security in the database, backed by an explicit
 * `getUser()` check at the top of every action. The Next.js documentation makes
 * the same point: the proxy is for optimistic checks, not session management or
 * authorization.
 *
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts` and moved it
 * to the Node.js runtime; the edge runtime is not available to it.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { clientEnv } from "@/lib/env";
import { type Database } from "@/lib/supabase/database.types";

/** Routes that require a session. Everything else is public. */
const PROTECTED_PREFIXES = ["/app", "/onboarding"];

/** Routes a signed-in user should be bounced away from. */
const AUTH_ROUTES = ["/login", "/signup"];

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // The response is created up front so the Supabase client has somewhere to
  // write refreshed cookies, and is then carried through unchanged unless a
  // redirect is required.
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Written twice on purpose. The request copy makes the new token
          // visible to code that runs later in this same request; the response
          // copy is what actually reaches the browser.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Supabase supplies no-store headers here. They matter: a CDN that
          // cached a response carrying a Set-Cookie header would hand one
          // user's session to the next visitor.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // IMPORTANT: `getUser()` and not `getSession()`.
  //
  // `getSession()` decodes whatever is in the cookie and returns it without
  // verifying the signature — a forged cookie would satisfy it. `getUser()`
  // validates the token against the Auth server, so the identity it returns is
  // trustworthy. Using the wrong one here is a well-known and severe mistake.
  //
  // Calling it also triggers the token refresh that is this function's reason
  // for existing.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Remember where they were headed so the round trip through the inbox
    // returns them to the page they actually wanted, not to a generic home.
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (user && AUTH_ROUTES.includes(pathname)) {
    const appUrl = request.nextUrl.clone();
    appUrl.pathname = "/app";
    appUrl.search = "";
    return NextResponse.redirect(appUrl);
  }

  return response;
}
