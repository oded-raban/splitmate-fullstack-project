/**
 * Household home.
 * =============================================================================
 * Answers "what do I owe?" above the fold and "why?" immediately below it. Those
 * two questions are the entire reason someone opens this app, so the balances
 * and the activity feed come before anything administrative.
 *
 * Everything here is derived from the ledger on each request. Nothing on this
 * screen is a stored summary, which is what makes it impossible for it to
 * disagree with the expense list.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Receipt, UserPlus } from "lucide-react";

import { requireMembership } from "@/lib/auth";
import { getActivity } from "@/lib/data/activity";
import { getBalances } from "@/lib/data/expenses";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { BalancePanel } from "@/components/balances/balance-panel";
import { EmptyState } from "@/components/common/empty-state";

export default async function HouseholdHomePage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const { user } = await requireMembership(householdId);

  const [household, balances, activity] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getBalances(householdId),
    getActivity(householdId),
  ]);
  if (!household) notFound();

  const isAlone = household.members.length === 1;
  // A household where nobody has paid anything has no balances worth showing —
  // only a row of zeroes, which looks like a bug rather than a starting point.
  const hasLedger = balances.some(
    (row) => row.paid !== 0 || row.owed !== 0 || row.settledOut !== 0,
  );

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

      {hasLedger ? (
        <>
          <BalancePanel
            balances={balances}
            members={household.members}
            currency={household.currency}
            viewerId={user.id}
          />

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`/app/households/${householdId}/expenses/new`}>
                <Plus className="size-4" />
                Add expense
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/app/households/${householdId}/settle`}>Settle up</Link>
            </Button>
          </div>
        </>
      ) : (
        <EmptyState
          icon={Receipt}
          title="No expenses yet"
          description="Record the first shared cost — rent, the internet bill, a supermarket run — and everyone's balance appears here."
          action={
            <Button asChild size="sm">
              <Link href={`/app/households/${householdId}/expenses/new`}>
                <Plus className="size-4" />
                Add the first expense
              </Link>
            </Button>
          }
        />
      )}

      <ActivityFeed
        entries={activity}
        members={household.members}
        currency={household.currency}
        viewerId={user.id}
        householdId={householdId}
      />
    </div>
  );
}
