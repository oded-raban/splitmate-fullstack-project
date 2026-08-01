/**
 * Server-side authentication helpers.
 * =============================================================================
 * Every server-side entry point — page, layout, Server Action, route handler —
 * establishes identity through this module, so there is exactly one place where
 * "who is making this request?" is answered.
 *
 * THE RULE: ALWAYS `getUser()`, NEVER `getSession()`
 * `supabase.auth.getSession()` reads the session out of the cookie and returns
 * it *without verifying the signature*. On the client that is fine — the cookie
 * came from this browser's own storage. On the server the cookie is attacker-
 * controlled input, and trusting it means anyone who crafts a plausible cookie
 * is whoever they claim to be.
 *
 * `getUser()` validates the token against the Supabase Auth server, so its
 * answer can be trusted. It costs a network round trip, which is why it is
 * wrapped in React's `cache()` below: several components in one render tree can
 * each ask who the user is, and only the first triggers an actual request.
 */

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * The verified current user, or null.
 *
 * `cache()` deduplicates the call for the duration of a single request, so a
 * layout, a page and three components asking independently cost one round trip
 * rather than five. It is per-request, not a shared cache, so one user's
 * identity can never be served to another.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});

/**
 * The verified current user, redirecting to the login page if there is none.
 *
 * For pages and layouts. The redirect preserves where the user was trying to go
 * so that after signing in they land there rather than on a generic home page —
 * which matters most for invitation links, where being dumped on a dashboard
 * loses the entire point of the click.
 *
 * @param returnTo Path to come back to after signing in.
 */
export async function requireUser(returnTo?: string): Promise<User> {
  const user = await getUser();

  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }

  return user;
}

/**
 * The current user's profile row (display name, avatar), or null.
 *
 * Separate from `getUser()` because the two answer different questions: the auth
 * user is identity, the profile is presentation. Most pages need only one of them.
 */
export const getProfile = cache(async () => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, email, avatar_url")
    .eq("id", user.id)
    .single();

  return data;
});
