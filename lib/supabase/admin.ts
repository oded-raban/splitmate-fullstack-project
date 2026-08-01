/**
 * ⚠️  SERVICE-ROLE CLIENT — BYPASSES ROW LEVEL SECURITY ENTIRELY. ⚠️
 * =============================================================================
 * This client authenticates as the database owner. RLS policies do not apply to
 * it. It can read and write every row in every household.
 *
 * THE ONLY SANCTIONED CALLER is the scheduled recurring-expense job
 * (app/api/cron/recurring/route.ts). That job is legitimate: it runs on a timer
 * with no signed-in user, so there is no JWT for RLS to evaluate, yet it must
 * create expenses in many different households. Every other code path in the
 * application has a user and therefore must use lib/supabase/server.ts.
 *
 * ENFORCEMENT, NOT JUST CONVENTION
 *   • An ESLint `no-restricted-imports` rule (eslint.config.mjs) makes importing
 *     this module from anything under components/ or from any page a build
 *     error, because a service key that reaches a client bundle is a total
 *     compromise of the database.
 *   • `serverEnv()` throws if evaluated in the browser, so even a successful
 *     import cannot produce a working client there.
 *
 * The session options below are not cosmetic: this client must never persist or
 * refresh a session, because it has no user session to maintain. Leaving the
 * defaults on would have it writing token state into a shared server context.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { clientEnv, serverEnv } from "@/lib/env";

export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createSupabaseClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
