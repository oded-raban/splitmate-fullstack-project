/**
 * Who owes what.
 * =============================================================================
 * The screen the product exists for. Two things are shown, and the distinction
 * between them is the whole idea:
 *
 *   • Each member's NET POSITION — the single number summarising everything they
 *     have paid and everything they owe. Derived from the ledger on every read,
 *     never stored, so it cannot drift out of agreement with the expenses it
 *     summarises.
 *
 *   • The SETTLEMENT PLAN — the shortest list of payments that clears every debt
 *     at once. Three people who owe each other in a ring can settle with two
 *     transfers instead of six, and nobody has to work out which.
 *
 * The plan is computed by `simplifyDebts`, a greedy heuristic bounded at n−1
 * transfers. It is not proven minimal: choosing the true minimum is NP-hard
 * (it is partition in disguise). n−1 is already far better than the naive
 * pairwise settlement, and the difference between "few" and "provably fewest"
 * is not worth an exponential algorithm to a household of five.
 *
 * A Server Component. The arithmetic is pure and the inputs are already on the
 * server, so none of this needs to reach the browser as JavaScript.
 */

import { ArrowRight } from "lucide-react";

import type { BalanceRow } from "@/lib/data/expenses";
import type { MemberDetail } from "@/lib/data/households";
import { displayNameOf, initialsOf } from "@/lib/display";
import { formatMoney, type Minor } from "@/lib/domain/money";
import { simplifyDebts, type Transfer } from "@/lib/domain/simplify";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BalancePanelProps {
  balances: BalanceRow[];
  members: MemberDetail[];
  currency: string;
  viewerId: string;
}

export function BalancePanel({
  balances,
  members,
  currency,
  viewerId,
}: BalancePanelProps) {
  const memberOf = (userId: string) =>
    members.find((member) => member.userId === userId);

  const nameOf = (userId: string) => {
    const member = memberOf(userId);
    return member ? displayNameOf(member) : "A former member";
  };

  /**
   * `simplifyDebts` throws if the positions do not sum to zero, because that
   * would mean the ledger is corrupt and any plan built from it would move the
   * wrong amounts. Catching it here degrades to showing the positions without a
   * plan, which is strictly better than a blank screen or a wrong instruction.
   */
  let plan: Transfer[] = [];
  let planFailed = false;
  try {
    plan = simplifyDebts(balances.map((row) => ({ userId: row.userId, net: row.net })));
  } catch {
    planFailed = true;
  }

  const settled = balances.every((row) => row.net === 0);
  const viewer = balances.find((row) => row.userId === viewerId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Balances</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {viewer ? <ViewerSummary net={viewer.net} currency={currency} /> : null}

          <ul className="divide-border divide-y">
            {balances.map((row) => {
              const member = memberOf(row.userId);

              return (
                <li key={row.userId} className="flex items-center gap-3 py-2.5">
                  <Avatar className="size-8">
                    {member?.avatarUrl ? (
                      <AvatarImage src={member.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback className="text-xs">
                      {member ? initialsOf(member) : "?"}
                    </AvatarFallback>
                  </Avatar>

                  <span className="min-w-0 flex-1 truncate text-sm">
                    {nameOf(row.userId)}
                    {row.userId === viewerId ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </span>

                  <span
                    className={`text-sm font-medium tabular-nums ${netClass(row.net)}`}
                    data-testid={`balance-${row.userId}`}
                  >
                    {row.net === 0
                      ? "settled up"
                      : row.net > 0
                        ? `is owed ${formatMoney(row.net, currency)}`
                        : `owes ${formatMoney(Math.abs(row.net) as Minor, currency)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {settled || planFailed ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Settle up in {plan.length} payment{plan.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {plan.map((transfer) => (
                <li
                  key={`${transfer.fromUserId}-${transfer.toUserId}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 text-sm"
                  data-testid="transfer"
                >
                  <span className="font-medium">
                    {transfer.fromUserId === viewerId
                      ? "You"
                      : nameOf(transfer.fromUserId)}
                  </span>
                  <ArrowRight
                    className="text-muted-foreground size-4"
                    aria-label="pays"
                  />
                  <span className="font-medium">
                    {transfer.toUserId === viewerId ? "you" : nameOf(transfer.toUserId)}
                  </span>
                  <span className="ml-auto tabular-nums">
                    {formatMoney(transfer.amountMinor, currency)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="text-muted-foreground mt-3 text-xs">
              The fewest transfers that clear every debt at once. Paying everyone you
              owe individually would take more.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function netClass(net: number): string {
  if (net === 0) return "text-muted-foreground";
  return net > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";
}

/**
 * The one number the viewer came to see, stated as a sentence.
 *
 * A signed figure would make the reader work out which direction is good. The
 * sentence does not.
 */
function ViewerSummary({ net, currency }: { net: Minor; currency: string }) {
  if (net === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="viewer-summary">
        You’re all settled up.
      </p>
    );
  }

  return (
    <p className="text-2xl font-semibold tabular-nums" data-testid="viewer-summary">
      <span className={netClass(net)}>
        {net > 0
          ? `You’re owed ${formatMoney(net, currency)}`
          : `You owe ${formatMoney(Math.abs(net) as Minor, currency)}`}
      </span>
    </p>
  );
}
