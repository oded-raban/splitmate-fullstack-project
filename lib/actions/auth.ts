"use server";

/**
 * Authentication Server Actions.
 * =============================================================================
 * Two ways in, chosen deliberately (see docs/02-architecture.md, ADR-4):
 *
 *   • Magic link — no password to choose, forget, reuse or leak. For an app
 *     people open a few times a week, a password is pure friction and one more
 *     credential to breach.
 *   • Google OAuth — one tap for the majority who have an account, and it
 *     supplies a real name and avatar, so the member list is recognisable
 *     immediately instead of showing three variations of "user".
 *
 * There is no password sign-in at all, which removes an entire category of
 * concern: no hashing decisions, no reset flow, no credential-stuffing surface.
 */

import { redirect } from "next/navigation";

import { clientEnv } from "@/lib/env";
import { fail, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { magicLinkSchema, toFieldErrors } from "@/lib/validation/auth";

/**
 * Emails a one-time sign-in link.
 *
 * Shaped for `useActionState`, hence the leading previous-state argument.
 *
 * A NOTE ON THE RESPONSE: this always reports success, even for an address that
 * has never signed up. That is intentional. Reporting "no account found" would
 * turn the login form into an oracle for checking whether a given person uses
 * SplitMate — a privacy leak that also helps an attacker build a target list.
 * Since `shouldCreateUser` is true, an unknown address simply becomes a new
 * account, so the uniform response is honest as well as safe.
 */
export async function requestMagicLink(
  _previousState: ActionResult<{ email: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ email: string }>> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    return fail("VALIDATION", "Check the details below", toFieldErrors(parsed.error));
  }

  const { email, next } = parsed.data;
  const supabase = await createClient();

  // The redirect target is built from our own configured origin rather than
  // from a request header. `Host` and `X-Forwarded-Host` are attacker-
  // controllable, and a magic link pointing at someone else's domain would hand
  // over the session it was meant to create.
  const callbackUrl = new URL("/auth/callback", clientEnv.NEXT_PUBLIC_SITE_URL);
  if (next) callbackUrl.searchParams.set("next", next);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      shouldCreateUser: true,
    },
  });

  if (error) {
    // Supabase enforces its own per-address and per-IP email rate limits, which
    // is what stops this endpoint being used to flood someone's inbox. That
    // case gets a specific message because "try again" is genuinely the fix.
    if (error.status === 429) {
      return fail(
        "RATE_LIMITED",
        "Too many sign-in attempts. Please wait a minute and try again.",
      );
    }

    console.error("[auth] magic link request failed", {
      status: error.status,
      message: error.message,
    });

    return fail(
      "UNKNOWN",
      "We couldn't send the sign-in link. Please try again in a moment.",
    );
  }

  return ok({ email });
}

/**
 * Starts the Google OAuth flow.
 *
 * Supabase returns a URL to redirect to rather than performing the redirect
 * itself, because the consent screen must be reached by a full browser
 * navigation — an XHR to Google's authorisation endpoint would be blocked and
 * would also hide the origin the user is granting access to.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const rawNext = formData.get("next");
  // Same open-redirect guard as the magic link path: only same-origin paths.
  const next =
    typeof rawNext === "string" && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : undefined;

  const callbackUrl = new URL("/auth/callback", clientEnv.NEXT_PUBLIC_SITE_URL);
  if (next) callbackUrl.searchParams.set("next", next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
      queryParams: {
        // Ask Google for a refresh token and show the account chooser, so a
        // shared computer does not silently sign in as the previous person.
        access_type: "offline",
        prompt: "select_account",
      },
    },
  });

  if (error || !data.url) {
    console.error("[auth] google oauth start failed", error?.message);
    redirect("/login?error=oauth");
  }

  // `redirect()` works by throwing a control-flow signal, so it is called here
  // at the end rather than inside a try block that might swallow it.
  redirect(data.url);
}

/** Ends the session and returns to the login page. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
