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
import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { type HouseholdRole } from "@/lib/supabase/types";

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
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email, avatar_url")
    .eq("id", user.id)
    .single();

  // A missing profile is not a normal state — `handle_new_user` creates one for
  // every account at sign-up. Swallowing the error here is what turned a real
  // failure into an avatar that quietly rendered "?" on every page, so it is
  // reported rather than discarded. The caller still gets null and degrades.
  if (error) {
    console.error("getProfile failed", {
      userId: user.id,
      code: error.code,
      message: error.message,
      details: error.details,
    });
    return null;
  }

  return data;
});

/* -------------------------------------------------------------------------- */
/* Household authorization                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The current user's role in a household, or null if they are not a member.
 *
 * Note what makes this trustworthy: the query runs through the RLS-constrained
 * client, so a non-member gets zero rows from the database itself rather than a
 * row this function then decides to reject. The check and the enforcement are
 * the same operation, which is why they cannot disagree.
 *
 * Cached per request, because the layout, the page and several components each
 * need to know the viewer's role in order to decide what to render.
 */
export const getMembershipRole = cache(
  async (householdId: string): Promise<HouseholdRole | null> => {
    const user = await getUser();
    if (!user) return null;

    const supabase = await createClient();
    const { data } = await supabase
      .from("household_members")
      .select("role")
      .eq("household_id", householdId)
      .eq("user_id", user.id)
      .maybeSingle();

    return data?.role ?? null;
  },
);

/**
 * Asserts membership, for pages and layouts.
 *
 * Non-members get a 404, not a 403. "You are not allowed to see this household"
 * confirms that the household exists, which is itself information the asker was
 * not entitled to — and with a UUID in the URL, a distinguishable response would
 * let someone verify guesses. A household you cannot see is indistinguishable
 * from one that does not exist.
 */
export async function requireMembership(householdId: string): Promise<{
  user: User;
  role: HouseholdRole;
}> {
  const user = await requireUser(`/app/households/${householdId}`);
  const role = await getMembershipRole(householdId);

  if (!role) notFound();

  return { user, role };
}

/**
 * Asserts membership *and* a sufficient role.
 *
 * This is a UX affordance layered on top of the real boundary, not the boundary
 * itself: RLS rejects the underlying write regardless of what this returns. Its
 * job is to make a page refuse to render an action the user cannot complete,
 * rather than letting them fill in a form that the database will reject.
 */
export async function requireRole(
  householdId: string,
  allowed: readonly HouseholdRole[],
): Promise<{ user: User; role: HouseholdRole }> {
  const membership = await requireMembership(householdId);

  if (!allowed.includes(membership.role)) notFound();

  return membership;
}

/** Roles permitted to manage members, invitations and household settings. */
export const MANAGER_ROLES = [
  "owner",
  "admin",
] as const satisfies readonly HouseholdRole[];
