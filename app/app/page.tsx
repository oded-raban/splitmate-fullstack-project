/**
 * Cross-household dashboard.
 * =============================================================================
 * The landing page after sign-in, and the answer to "where do I stand overall?"
 * for someone in more than one household — a flat with roommates and a holiday
 * house with friends should not require remembering two URLs.
 *
 * A user with no households never sees this page: there is nothing to summarise,
 * and an empty dashboard with a button on it is a worse first screen than the
 * dedicated onboarding flow that button would lead to.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Plus, Users } from "lucide-react";

import { getHouseholdsForUser } from "@/lib/data/households";
import { ROLE_LABELS } from "@/lib/display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Home" };

export default async function DashboardPage() {
  const households = await getHouseholdsForUser();

  if (households.length === 0) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your households</h1>
          <p className="text-muted-foreground text-sm">
            {households.length === 1
              ? "One shared space."
              : `${households.length} shared spaces.`}
          </p>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/onboarding">
            <Plus className="size-4" />
            New household
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {households.map((household) => (
          <Card
            key={household.id}
            className="relative transition-shadow hover:shadow-sm"
          >
            <CardHeader>
              <CardTitle className="text-base">
                <Link
                  href={`/app/households/${household.id}`}
                  // Stretched so the whole card is the click target while the
                  // accessible name stays just the household's name.
                  className="after:absolute after:inset-0"
                >
                  {household.name}
                </Link>
              </CardTitle>
              <CardAction>
                <Badge variant="secondary">{ROLE_LABELS[household.role]}</Badge>
              </CardAction>
            </CardHeader>

            <CardContent className="text-muted-foreground flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5">
                <Users className="size-4" aria-hidden="true" />
                {household.memberCount === 1
                  ? "Just you"
                  : `${household.memberCount} members`}
              </span>
              <span>{household.currency}</span>
              <ArrowRight className="ml-auto size-4" aria-hidden="true" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Balances across households land in Phase 5, once the expense ledger and
          settlement engine exist to derive them from. */}
    </div>
  );
}
