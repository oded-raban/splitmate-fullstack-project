/**
 * OAuth / magic-link callback.
 * =============================================================================
 * Where the user lands after clicking a sign-in link or approving Google. Its
 * job is to convert the one-time credential in the URL into a session cookie
 * and then send the user where they were originally going.
 *
 * This is a Route Handler rather than a page because it produces a redirect and
 * sets cookies, and never renders anything.
 *
 * TWO CREDENTIAL SHAPES ARE ACCEPTED, for a practical reason:
 *
 *   • `?code=…`  — the PKCE authorization code, used by Google OAuth and by
 *     magic links under Supabase's default email template.
 *   • `?token_hash=…&type=…` — used when the email template is customised to
 *     link here directly (the form Supabase recommends for server-side apps,
 *     because it avoids a hop through their verify endpoint).
 *
 * Handling both means changing the email template later does not break sign-in,
 * which is exactly the kind of coupling that produces a bad afternoon.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { clientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Where to go after a successful sign-in when nothing else was requested. */
const DEFAULT_DESTINATION = "/app";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  // Redirects are built against the configured site URL, never against the
  // request's Host header — that header is attacker-controllable, and using it
  // here would let a crafted request bounce a freshly authenticated user to
  // another origin.
  const siteUrl = clientEnv.NEXT_PUBLIC_SITE_URL;
  const destination = safeNext(searchParams.get("next")) ?? DEFAULT_DESTINATION;

  // The provider reports its own failures here (for example, the user pressed
  // "cancel" on Google's consent screen).
  const providerError = searchParams.get("error");
  if (providerError) {
    const description = searchParams.get("error_description");
    console.info("[auth] provider returned an error", { providerError, description });
    return NextResponse.redirect(new URL("/login?error=denied", siteUrl));
  }

  const supabase = await createClient();

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // Almost always a link that was already used or has expired — both
      // ordinary events, not incidents, so this is logged at info level.
      console.info("[auth] code exchange failed", error.message);
      return NextResponse.redirect(new URL("/login?error=expired", siteUrl));
    }

    return NextResponse.redirect(new URL(destination, siteUrl));
  }

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });

    if (error) {
      console.info("[auth] otp verification failed", error.message);
      return NextResponse.redirect(new URL("/login?error=expired", siteUrl));
    }

    return NextResponse.redirect(new URL(destination, siteUrl));
  }

  // Reached with no credential at all — someone opened the callback URL
  // directly, or a mail client mangled the link.
  return NextResponse.redirect(new URL("/login?error=invalid", siteUrl));
}

/**
 * Accepts only same-origin paths.
 *
 * Without this the `next` parameter is an open redirect: `?next=https://evil.example`
 * would deliver a freshly signed-in user to an attacker's page, which is a
 * convincing phishing primitive because the journey genuinely started on our
 * domain. Rejecting "//" as well as "http…" matters — browsers treat a
 * protocol-relative "//evil.example" as absolute.
 */
function safeNext(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith("/")) return undefined;
  if (value.startsWith("//")) return undefined;
  return value;
}
