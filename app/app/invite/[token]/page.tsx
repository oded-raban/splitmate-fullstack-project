/**
 * Invitation landing page.
 * =============================================================================
 * The preview is the point. Someone arriving here has clicked a link from a chat
 * message, and asking them to join a household without telling them whose it is
 * both reads as phishing and trains the habit that makes real phishing work.
 *
 * The lookup runs through `preview_invitation`, a SECURITY DEFINER function, and
 * it has to: the visitor is not a member yet, so RLS denies them the invitation
 * row and the household row alike. The function is keyed solely on the raw token
 * — 32 bytes of CSPRNG output, stored only as a SHA-256 hash — so it reveals the
 * household name to whoever already holds a working link and nothing to anyone
 * else.
 *
 * Every failure state gets its own sentence rather than a shared "invalid link",
 * because the useful next step differs: an expired link needs a fresh one, a
 * mismatched email needs a different sign-in, and an already-accepted one needs
 * no action at all.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, MailWarning, Users } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { getInvitationPreview } from "@/lib/data/households";
import { ROLE_LABELS } from "@/lib/display";
import { AcceptInvitationForm } from "@/components/invitations/accept-invitation-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Invitation" };

/** One sentence per failure, phrased around what the reader should do next. */
const PROBLEMS: Record<string, { title: string; body: string }> = {
  invalid: {
    title: "This invitation isn't valid",
    body: "The link may have been mistyped or cut short by the app it was sent through. Ask whoever invited you to send it again.",
  },
  revoked: {
    title: "This invitation was cancelled",
    body: "Someone in the household withdrew it. Ask them for a new link if you should still be joining.",
  },
  used: {
    title: "This invitation has already been used",
    body: "Each link works once. If that wasn't you, ask for a fresh one — and mention that the old link may have been seen by someone else.",
  },
  expired: {
    title: "This invitation has expired",
    body: "Invitations last 7 days so that an old link in a group chat can't be used later. Ask for a new one.",
  },
  email_mismatch: {
    title: "This invitation is for a different address",
    body: "It was sent to a specific email address, and you're signed in with another one. Sign out and sign back in with the address it was sent to.",
  },
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // The proxy already redirects an unauthenticated request here to the login
  // page carrying `next`, so this is the belt to that braces — and it keeps the
  // page correct if the proxy's matcher ever changes.
  await requireUser(`/app/invite/${token}`);

  const preview = await getInvitationPreview(token);

  // Already in: send them straight through rather than showing a button that
  // would succeed silently and change nothing.
  if (preview.status === "already_member" && preview.householdId) {
    redirect(`/app/households/${preview.householdId}`);
  }

  const problem = PROBLEMS[preview.status];

  if (problem) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <Card>
          <CardHeader className="items-center space-y-3 text-center">
            <span className="bg-muted flex size-11 items-center justify-center rounded-full">
              <MailWarning
                className="text-muted-foreground size-5"
                aria-hidden="true"
              />
            </span>
            <CardTitle className="text-lg">{problem.title}</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4 text-center">
            {preview.householdName ? (
              <p className="text-muted-foreground text-sm">
                It was for{" "}
                <span className="text-foreground">{preview.householdName}</span>.
              </p>
            ) : null}
            <p className="text-muted-foreground text-sm">{problem.body}</p>

            <Button asChild variant="outline" className="w-full">
              <Link href="/app">
                Go to your households
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader className="items-center space-y-3 text-center">
          <span className="bg-primary/10 flex size-11 items-center justify-center rounded-full">
            <Users className="text-primary size-5" aria-hidden="true" />
          </span>
          <CardTitle className="text-lg">
            {preview.inviterName
              ? `${preview.inviterName} invited you`
              : "You've been invited"}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-5">
          <p className="text-center text-sm">
            Join <span className="font-medium">{preview.householdName}</span> as{" "}
            {preview.invitedRole === "admin" ? "an" : "a"}{" "}
            {ROLE_LABELS[preview.invitedRole ?? "member"].toLowerCase()}.
          </p>

          <p className="text-muted-foreground text-center text-sm">
            You’ll see every expense the household records, and what you owe or are
            owed. They’ll see the same about you.
          </p>

          <AcceptInvitationForm token={token} />
        </CardContent>
      </Card>
    </div>
  );
}
