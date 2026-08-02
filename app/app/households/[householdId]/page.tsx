/**
 * Household home.
 * =============================================================================
 * Balances and the recent-activity feed are the point of this screen, and both
 * are derived from the expense ledger — which arrives in Phase 4. Until then it
 * shows the household as it currently is and points at the one action that makes
 * it useful: getting the other people in.
 */

import Link from "next/link";
import { Receipt, UserPlus } from "lucide-react";

import { getHouseholdWithMembers } from "@/lib/data/households";
import { displayNameOf, ROLE_LABELS } from "@/lib/display";
import { notFound } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { initialsOf } from "@/lib/display";

export default async function HouseholdHomePage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const household = await getHouseholdWithMembers(householdId);
  if (!household) notFound();

  const isAlone = household.members.length === 1;

  return (
    <div className="space-y-6">
      {isAlone ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">You’re the only one here</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Splitting expenses needs at least two people. Invite your roommates and
              they’ll see everything you record from the moment they join.
            </p>
            <Button asChild size="sm">
              <Link href={`/app/households/${householdId}/members`}>
                <UserPlus className="size-4" />
                Invite roommates
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {household.members.length} member{household.members.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y">
            {household.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 py-2.5">
                <Avatar className="size-8">
                  {member.avatarUrl ? (
                    <AvatarImage src={member.avatarUrl} alt="" />
                  ) : null}
                  <AvatarFallback className="text-xs">
                    {initialsOf(member)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {displayNameOf(member)}
                  {member.isViewer ? (
                    <span className="text-muted-foreground"> (you)</span>
                  ) : null}
                </span>
                <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="text-muted-foreground flex items-center gap-3 py-6 text-sm">
          <Receipt className="size-5 shrink-0" aria-hidden="true" />
          <p>
            Expenses, balances and settling up arrive next. The ledger this household
            will keep is already in the database — nothing recorded here will need
            migrating.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
