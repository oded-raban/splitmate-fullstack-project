/**
 * Settle up.
 * =============================================================================
 * The settlement plan, with a button on each line that records the payment it
 * describes. The point is that nobody has to work out who to pay: the plan is
 * computed from the ledger, and the amount is prefilled from the plan.
 *
 * Payments already recorded are listed underneath and can be voided. Voiding
 * rather than deleting is deliberate — "I paid you" is a claim someone else may
 * dispute, and the history should show that it was made and withdrawn rather
 * than quietly losing it.
 */

import { notFound } from "next/navigation";
import { HandCoins } from "lucide-react";

import { requireMembership } from "@/lib/auth";
import { getBalances, getSettlements } from "@/lib/data/expenses";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { displayNameOf } from "@/lib/display";
import { formatMoney } from "@/lib/domain/money";
import { simplifyDebts, type Transfer } from "@/lib/domain/simplify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { TimeAgo } from "@/components/common/time-ago";
import { SettleUpForm } from "@/components/settle/settle-up-form";
import { VoidSettlementButton } from "@/components/settle/void-settlement-button";

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  bit: "Bit",
  cash: "Cash",
  paypal: "PayPal",
  other: "Other",
};

export const metadata = { title: "Settle up" };

export default async function SettlePage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const { user } = await requireMembership(householdId);

  const [household, balances, settlements] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getBalances(householdId),
    getSettlements(householdId),
  ]);
  if (!household) notFound();

  const nameOf = (userId: string) => {
    const member = household.members.find((candidate) => candidate.userId === userId);
    return member ? displayNameOf(member) : "A former member";
  };

  let plan: Transfer[] = [];
  try {
    plan = simplifyDebts(balances.map((row) => ({ userId: row.userId, net: row.net })));
  } catch {
    // A ledger that does not sum to zero cannot produce a trustworthy plan, and
    // showing a wrong one would be worse than showing none.
    plan = [];
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Settle up</h2>

      {plan.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="Nothing to settle"
          description="Everyone in this household is square. Balances will reappear here as soon as someone records a new expense."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {plan.length} payment{plan.length === 1 ? "" : "s"} clears everything
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {plan.map((transfer) => {
                // Anyone may record a payment they are party to. Recording one
                // between two other people is left to them: the person who
                // handed over the money is the one who knows it happened.
                const involvesViewer =
                  transfer.fromUserId === user.id || transfer.toUserId === user.id;

                return (
                  <li
                    key={`${transfer.fromUserId}-${transfer.toUserId}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
                    data-testid="settle-row"
                  >
                    {/* Built as one string rather than as styled fragments.
                        Splitting "pays" into "pay" + "s" across two text nodes
                        renders correctly but is announced as "pay s" by a screen
                        reader, because assistive technology joins adjacent nodes
                        with a space. */}
                    <span className="min-w-0 flex-1 text-sm">
                      {transfer.fromUserId === user.id
                        ? `You pay ${nameOf(transfer.toUserId)}`
                        : transfer.toUserId === user.id
                          ? `${nameOf(transfer.fromUserId)} pays you`
                          : `${nameOf(transfer.fromUserId)} pays ${nameOf(transfer.toUserId)}`}
                    </span>

                    <span className="text-sm font-medium tabular-nums">
                      {formatMoney(transfer.amountMinor, household.currency)}
                    </span>

                    {involvesViewer ? (
                      <SettleUpForm
                        householdId={householdId}
                        currency={household.currency}
                        members={household.members}
                        fromUserId={transfer.fromUserId}
                        toUserId={transfer.toUserId}
                        suggestedMinor={transfer.amountMinor}
                        trigger={
                          <Button size="sm" variant="outline">
                            Record
                          </Button>
                        }
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {settlements.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payments recorded</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {settlements.map((settlement) => (
                <li
                  key={settlement.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    {nameOf(settlement.fromUser)} paid {nameOf(settlement.toUser)}{" "}
                    <TimeAgo
                      value={settlement.settledAt}
                      className="text-muted-foreground"
                    />
                  </span>

                  {settlement.voidedAt ? (
                    <Badge variant="outline">voided</Badge>
                  ) : (
                    <Badge variant="secondary">
                      {METHOD_LABELS[settlement.method] ?? settlement.method}
                    </Badge>
                  )}

                  <span
                    className={
                      settlement.voidedAt
                        ? "text-muted-foreground tabular-nums line-through"
                        : "tabular-nums"
                    }
                  >
                    {formatMoney(settlement.amountMinor, household.currency)}
                  </span>

                  {!settlement.voidedAt &&
                  (settlement.fromUser === user.id || settlement.toUser === user.id) ? (
                    <VoidSettlementButton
                      householdId={householdId}
                      settlementId={settlement.id}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
