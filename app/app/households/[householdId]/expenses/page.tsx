/**
 * Expense history.
 * =============================================================================
 * The cursor lives in the URL rather than in component state. That makes a page
 * of history a real, shareable, back-button-able location — and it keeps this a
 * Server Component, so the ledger is queried and rendered on the server and the
 * browser never receives a database client.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Receipt } from "lucide-react";

import { requireMembership } from "@/lib/auth";
import { getExpenses } from "@/lib/data/expenses";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { displayNameOf } from "@/lib/display";
import { formatMoney } from "@/lib/domain/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ householdId: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { householdId } = await params;
  const { cursor } = await searchParams;

  // The layout already asserts membership; repeating it here means this route
  // stays protected on its own terms rather than depending on a parent that a
  // later refactor might restructure.
  await requireMembership(householdId);

  const household = await getHouseholdWithMembers(householdId);
  if (!household) notFound();

  const { items, nextCursor } = await getExpenses(householdId, { cursor });

  const nameOf = (userId: string) => {
    const member = household.members.find((m) => m.userId === userId);
    if (!member) return "A former member";
    return member.isViewer ? "You" : displayNameOf(member);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Expenses</h2>
        <Button asChild size="sm">
          <Link href={`/app/households/${householdId}/expenses/new`}>
            <Plus className="size-4" />
            Add expense
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={cursor ? "Nothing further back" : "No expenses yet"}
          description={
            cursor
              ? "You have reached the start of this household's history."
              : "Record the first shared cost and everyone's balance updates immediately."
          }
          action={
            cursor ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/households/${householdId}/expenses`}>
                  Back to the top
                </Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href={`/app/households/${householdId}/expenses/new`}>
                  <Plus className="size-4" />
                  Add the first expense
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {items.map((expense) => (
                <li key={expense.id}>
                  <Link
                    href={`/app/households/${householdId}/expenses/${expense.id}`}
                    className="hover:bg-accent/50 flex items-center gap-3 px-4 py-3 transition-colors"
                    data-testid="expense-row"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {expense.description}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {nameOf(expense.payerId)} paid ·{" "}
                        {new Date(expense.spentAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                        {expense.categoryName ? ` · ${expense.categoryName}` : ""}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-medium tabular-nums">
                        {formatMoney(expense.amountMinor, household.currency)}
                      </p>
                      {expense.viewerShareMinor === null ? (
                        <Badge variant="outline" className="mt-0.5 text-[10px]">
                          not yours
                        </Badge>
                      ) : (
                        <p className="text-muted-foreground text-xs tabular-nums">
                          your share{" "}
                          {formatMoney(expense.viewerShareMinor, household.currency)}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/app/households/${householdId}/expenses?cursor=${nextCursor}`}
              // Scroll to the top so the next page starts where the eye already
              // is, rather than at the bottom of a list the reader has not seen.
              scroll
            >
              Older expenses
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
