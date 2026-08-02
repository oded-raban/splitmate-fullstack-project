"use server";

/**
 * Invitation Server Actions.
 * =============================================================================
 * An invitation is a bearer credential: whoever presents the token joins the
 * household. That single sentence drives every decision in this file.
 *
 *   • The token is 32 bytes from a CSPRNG, not a UUID. A UUID v4 carries 122
 *     bits and, more importantly, is a value we hand out routinely elsewhere —
 *     using one as a secret invites it being logged, pasted or reused.
 *
 *   • Only its SHA-256 hash is stored, exactly as a password would be. The raw
 *     token exists in the returned link and nowhere else, so a dump of the
 *     `invitations` table grants an attacker nothing: acceptance requires the
 *     preimage, and `accept_invitation` hashes what it is given before matching.
 *
 *   • It expires, because a link pasted into a group chat outlives the reason it
 *     was sent, and it is single-use when accepted, so a forwarded link cannot
 *     admit a second person.
 *
 *   • It can carry an email address, which binds it to that recipient. Without
 *     one it is a shareable link, which is a deliberate and clearly-labelled
 *     choice in the UI rather than an accident of leaving a field blank.
 */

import { createHash, randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";
import { clientEnv } from "@/lib/env";
import { fromDatabaseError, raisedCodeOf } from "@/lib/errors";
import { fail, failures, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  invitationIdSchema,
} from "@/lib/validation/households";

/** How long an invitation stays usable. */
const INVITATION_TTL_DAYS = 7;

/**
 * Member cap on the free plan. The PRD describes billing as designed but not
 * implemented; the limit itself is real, so the boundary exists in the data and
 * in the code rather than only in a pricing table.
 */
const FREE_PLAN_MEMBER_LIMIT = 6;

function generateToken(): { token: string; tokenHash: string } {
  // base64url so the token survives being placed in a path segment untouched —
  // no percent-encoding to get wrong on either end.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

function invitationUrl(token: string): string {
  // Built from our own configured origin, never from a request header: `Host`
  // and `X-Forwarded-Host` are attacker-controllable, and an invitation link
  // pointing at someone else's domain would deliver the token to them.
  return new URL(`/app/invite/${token}`, clientEnv.NEXT_PUBLIC_SITE_URL).toString();
}

export interface CreatedInvitation {
  id: string;
  url: string;
  email: string | null;
}

/**
 * Creates an invitation and returns its link.
 *
 * The link is returned rather than only emailed, and that is the primary
 * delivery mechanism by design: the fastest path to a working household is one
 * person pasting a link into the chat the household already uses. Email delivery
 * is layered on in Phase 8; until then an email-targeted invitation is created
 * and bound to that address, and the link is shown for the admin to send.
 */
export async function createInvitation(
  _previousState: ActionResult<CreatedInvitation> | undefined,
  formData: FormData,
): Promise<ActionResult<CreatedInvitation>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = createInvitationSchema.safeParse({
    householdId: formData.get("householdId"),
    email: formData.get("email"),
    role: formData.get("role") ?? undefined,
  });

  if (!parsed.success) {
    return fail("VALIDATION", "Check the details below", {
      ...Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          [issue.message],
        ]),
      ),
    });
  }

  const { householdId, email, role } = parsed.data;
  const supabase = await createClient();

  // Reading the household also proves membership: RLS returns no row to someone
  // outside it, so this doubles as the existence check.
  const { data: household, error: householdError } = await supabase
    .from("households")
    .select("id, plan, household_members(count)")
    .eq("id", householdId)
    .maybeSingle();

  if (householdError)
    return fromDatabaseError(householdError, "createInvitation lookup");
  if (!household) return failures.notFound("That household");

  const memberCount = household.household_members[0]?.count ?? 1;

  if (household.plan === "free" && memberCount >= FREE_PLAN_MEMBER_LIMIT) {
    return fail(
      "BUSINESS_RULE",
      `Households on the free plan can have up to ${FREE_PLAN_MEMBER_LIMIT} members.`,
    );
  }

  if (email) {
    // Checked before creating anything, so the admin gets "they're already in"
    // rather than a link that will fail confusingly when clicked.
    const { data: existing } = await supabase
      .from("household_members")
      .select("user_id, profiles!inner(email)")
      .eq("household_id", householdId)
      .eq("profiles.email", email)
      .maybeSingle();

    if (existing) {
      return fail("BUSINESS_RULE", "That person is already in this household.", {
        email: ["They're already a member"],
      });
    }
  }

  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("invitations")
    .insert({
      household_id: householdId,
      email: email ?? null,
      token_hash: tokenHash,
      role,
      created_by: user.id,
      expires_at: expiresAt.toISOString(),
    })
    .select("id, email")
    .single();

  if (error) return fromDatabaseError(error, "createInvitation");

  revalidatePath(`/app/households/${householdId}/members`);

  return ok({ id: data.id, url: invitationUrl(token), email: data.email });
}

/**
 * Cancels an outstanding invitation.
 *
 * Marked revoked rather than deleted: the row is the only record that someone
 * was invited and by whom, and an admin investigating "who let this person in?"
 * needs the history to survive the cancellation.
 */
export async function revokeInvitation(formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = invitationIdSchema.safeParse({
    householdId: formData.get("householdId"),
    invitationId: formData.get("invitationId"),
  });
  if (!parsed.success) return failures.notFound("That invitation");

  const { householdId, invitationId } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .eq("household_id", householdId)
    .is("accepted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return fromDatabaseError(error, "revokeInvitation");
  if (!data) return failures.notFound("That invitation");

  revalidatePath(`/app/households/${householdId}/members`);
  return ok();
}

/**
 * Redeems an invitation token.
 *
 * All of the validation — hash lookup, revocation, expiry, single use, email
 * binding — happens inside the `accept_invitation` RPC. It has to: the invitee
 * is not a member yet, so RLS denies them any read of the `invitations` table,
 * and the alternative of opening a readable policy would let anyone enumerate
 * pending invitations across every household in the system.
 *
 * Each failure the function raises is remapped here, because the SQL function
 * knows the rule that was broken but not what the person should do next.
 */
export async function acceptInvitation(
  _previousState: ActionResult<never> | undefined,
  formData: FormData,
): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = acceptInvitationSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    return fail("BUSINESS_RULE", "That invitation link isn't valid.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_token: parsed.data.token,
  });

  if (error) {
    return fromDatabaseError(
      error,
      `accept_invitation (${raisedCodeOf(error) ?? "?"})`,
      {
        INVITE_INVALID:
          "That invitation link isn't valid. Ask whoever invited you for a new one.",
        INVITE_REVOKED: "That invitation was cancelled. Ask for a new one.",
        INVITE_USED:
          "That invitation has already been used. Ask whoever invited you for a new link.",
        INVITE_EXPIRED: "That invitation has expired. Ask for a fresh link.",
        INVITE_EMAIL_MISMATCH:
          "This invitation was sent to a different email address. Sign in with that address to accept it.",
      },
    );
  }

  if (!data) return failures.unknown();

  // Invalidate before navigating so the household switcher in the shell renders
  // with the newly joined household already in it.
  revalidatePath("/app", "layout");

  // Redirecting from the action rather than from an effect on the client is what
  // makes this correct. Navigating client-side after a successful accept meant
  // re-rendering the invitation page first, which then reported the token as
  // already used — the invitee's reward for joining was an error screen.
  redirect(`/app/households/${data}`);
}
