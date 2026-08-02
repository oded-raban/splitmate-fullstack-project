/**
 * First-run screen.
 * =============================================================================
 * Reached in two situations that look the same but are not: a brand-new account
 * with nowhere to go, and an existing user deliberately starting a second
 * household. The copy and the escape hatch adapt, because telling someone who
 * already has three households to "get started" is noise.
 *
 * Joining is not a form here. An invitation is a link, and the person who has
 * one clicks it rather than transcribing a token — so this page explains that
 * instead of offering a paste box that would mostly collect mistyped tokens.
 */

import Link from "next/link";
import { ArrowLeft, MailOpen } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { getHouseholdsForUser } from "@/lib/data/households";
import { CreateHouseholdForm } from "@/components/households/create-household-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Create a household" };

export default async function OnboardingPage() {
  await requireUser("/onboarding");
  const households = await getHouseholdsForUser();
  const isFirst = households.length === 0;

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-4 py-10">
      {!isFirst ? (
        <Link
          href="/app"
          className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to your households
        </Link>
      ) : null}

      <Card>
        <CardHeader className="space-y-1.5">
          <CardTitle className="text-xl">
            {isFirst ? "Set up your first household" : "Create another household"}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {isFirst
              ? "A household is the shared space where you and your roommates record what you spend."
              : "A separate space with its own members, currency and ledger."}
          </p>
        </CardHeader>

        <CardContent>
          <CreateHouseholdForm />
        </CardContent>
      </Card>

      {isFirst ? (
        <div className="text-muted-foreground mt-6 flex items-start gap-2.5 text-sm">
          <MailOpen className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Been invited to one instead? Open the invitation link your roommate sent you
            and you’ll join theirs — no need to create anything here.
          </p>
        </div>
      ) : null}
    </main>
  );
}
