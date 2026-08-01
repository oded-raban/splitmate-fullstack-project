/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * =============================================================================
 * This client carries the SIGNED-IN USER'S JWT, which is the entire point: every
 * query it makes is evaluated against Row Level Security as that user. A bug in
 * our query logic can therefore return too little data, but never data belonging
 * to another household.
 *
 * Contrast with lib/supabase/admin.ts, which bypasses RLS entirely and is
 * restricted by an ESLint rule to the one place that legitimately needs it.
 *
 * WHY THIS IS A FUNCTION AND NOT A MODULE-LEVEL SINGLETON
 * The client is built from the request's cookies, and in a server environment a
 * single module instance is shared across concurrent requests from different
 * users. A cached client would serve one user's session to another — the most
 * severe class of bug this application could have. A fresh client per call costs
 * almost nothing and makes that impossible.
 *
 * NEXT.JS 16 NOTE
 * `cookies()` is async and must be awaited; synchronous access was removed in
 * v16. That is why this factory is itself async.
 *
 * The `Database` type parameter is what makes every query in the application
 * check against the real schema: a misspelt column or a filter on a column that
 * does not exist becomes a compile error rather than an empty result set at
 * runtime. Regenerate it with `npm run db:types` after every migration.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { clientEnv } from "@/lib/env";
import { type Database } from "@/lib/supabase/database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components are not allowed to write cookies — by the time
            // one renders, the response headers are already being streamed.
            //
            // Swallowing this is safe *because* proxy.ts refreshes the session
            // on every request before the render begins, so the tokens written
            // there are already current. Without that proxy step this catch
            // would silently log users out when their access token expired.
          }
        },
      },
    },
  );
}
