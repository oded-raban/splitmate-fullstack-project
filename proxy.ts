/**
 * Proxy — runs before every matched request.
 * =============================================================================
 * In Next.js 16 this file replaces the old `middleware.ts` convention. The
 * exported function must be named `proxy`, and it runs on the Node.js runtime
 * (the edge runtime is not supported here).
 *
 * Its only job is to refresh the Supabase session cookie and perform the
 * optimistic redirect for signed-out visitors. The actual logic lives in
 * lib/supabase/proxy.ts; this file is the thin binding plus the matcher.
 *
 * It is NOT an authorization boundary — see the note in lib/supabase/proxy.ts.
 */

import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /**
   * Match every path except static assets and image files.
   *
   * The exclusions are a real performance decision, not tidiness: this function
   * makes a network call to the Supabase Auth server on every request it
   * handles. Running it for each favicon, font and stylesheet would multiply
   * that cost by the number of assets on the page for no benefit, since a
   * static file has no session to refresh.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf)$).*)",
  ],
};
