/**
 * Supabase client for the browser.
 * =============================================================================
 * Used for exactly two things, both of which genuinely require a live client-
 * side connection:
 *
 *   1. Realtime subscriptions — the collaborative shopping list, where an item
 *      ticked off on one phone must appear on another within a second. That is
 *      a WebSocket, which a Server Component cannot hold open.
 *
 *   2. Direct-to-Storage receipt uploads — sending the file straight from the
 *      browser to Supabase Storage rather than proxying it through a serverless
 *      function, which would double the bandwidth and run into request size
 *      limits without adding any security (the same RLS policy applies either way).
 *
 * Everything else — every read that renders a page, every write — goes through
 * Server Components and Server Actions instead.
 *
 * The anon key embedded here is public by design. It identifies the project but
 * grants nothing on its own: every request it makes is still filtered by Row
 * Level Security. Its safety rests entirely on RLS being enabled on every table,
 * which migration 03 does with no permissive fallback.
 */

import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env";
import { type Database } from "@/lib/supabase/database.types";

export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
