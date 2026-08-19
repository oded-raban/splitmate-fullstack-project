/**
 * One expense, in full.
 * =============================================================================
 * Shows who paid, how it was divided, and what each person's share came to. The
 * split breakdown matters more than it looks: "why do I owe this?" is the
 * question that turns a shared-expense app into an argument, and answering it
 * without anyone having to ask is most of the product.
 *
 * Edit and delete are offered by affordance here and enforced by RLS in the
 * database. Hiding a button the user may not press is a courtesy; the policy is
 * what makes it true.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { requireMembership } from "@/lib/auth";
import { getReceiptUrl } from "@/lib/actions/receipts";
import { getExpense } from "@/lib/data/expenses";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { displayNameOf, initialsOf } from "@/lib/display";
import { formatMoney } from "@/lib/domain/money";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { ReceiptPanel } from "@/components/expenses/receipt-panel";

const METHOD_LABELS: Record<string, string> = {
  equal: "Split equally",
  exact: "Exact amounts",
  percentage: "By percentage",
  shares: "By shares",
};

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ householdId: string; expenseId: string }>;
}) {
  const { householdId, expenseId } = await params;
  const { user, role } = await requireMembership(householdId);

  const [household, expense] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getExpense(householdId, expenseId),
  ]);
  if (!household || !expense) notFound();

  const memberOf = (userId: string) =>
    household.members.find((member) => member.userId === userId);

  const nameOf = (userId: string) => {
    const member = memberOf(userId);
    return member ? displayNameOf(member) : "A former member";
  };

  // Mirrors the `can_modify_expense` policy in the database. If the two ever
  // disagree, the database wins and the user sees a refusal rather than a
  // silently ignored click — which is the right way round for that failure.
  const canModify =
    expense.createdBy === user.id ||
    expense.payerId === user.id ||
    role === "owner" ||
    role === "admin";

  // Signed here rather than in the client component so the credential is minted
  // by a request that has already passed RLS, and so the image starts loading
  // with the page instead of after a round trip from the browser.
  const receiptUrl = expense.receiptPath
    ? await getReceiptUrl(expense.receiptPath)
    : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{expense.description}</CardTitle>
          {canModify ? (
            <CardAction className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/app/households/${householdId}/expenses/${expense.id}/edit`}
                >
                  <Pencil className="size-4" />
                  Edit
                </Link>
              </Button>
              <DeleteExpenseButton householdId={householdId} expenseId={expense.id} />
            </CardAction>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoney(expense.amountMinor, household.currency)}
            </p>
            <p className="text-muted-foreground text-sm">
              paid by {nameOf(expense.payerId)} on{" "}
              {new Date(expense.spentAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {METHOD_LABELS[expense.splitMethod] ?? expense.splitMethod}
            </Badge>
            {expense.categoryName ? (
              <Badge variant="outline">
                {expense.categoryIcon ? `${expense.categoryIcon} ` : ""}
                {expense.categoryName}
              </Badge>
            ) : null}
          </div>

          {expense.note ? (
            <p className="text-muted-foreground border-l-2 pl-3 text-sm">
              {expense.note}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who owes what</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y">
            {expense.splits.map((split) => {
              const member = memberOf(split.userId);

              return (
                <li key={split.userId} className="flex items-center gap-3 py-2.5">
                  <Avatar className="size-7">
                    {member?.avatarUrl ? (
                      <AvatarImage src={member.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[10px]">
                      {member ? initialsOf(member) : "?"}
                    </AvatarFallback>
                  </Avatar>

                  <span className="min-w-0 flex-1 truncate text-sm">
                    {nameOf(split.userId)}
                    {split.userId === user.id ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </span>

                  <span className="text-sm font-medium tabular-nums">
                    {formatMoney(split.shareMinor, household.currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <ReceiptPanel
        householdId={householdId}
        expenseId={expense.id}
        receiptUrl={receiptUrl}
        receiptPath={expense.receiptPath}
        canModify={canModify}
      />
    </div>
  );
}
