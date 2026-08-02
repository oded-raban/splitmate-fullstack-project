/**
 * Edit an expense.
 * =============================================================================
 * Reuses the create form rather than growing a second one. The two screens
 * differ only in what they start from and which Server Action they submit to,
 * and keeping them as one component is what guarantees an edited split is
 * computed exactly the way the original was.
 *
 * The form is handed the row's current `updated_at`, which it submits back for
 * optimistic-concurrency checking. Two roommates editing the same expense at
 * once is not hypothetical — it is a normal Saturday — and without that check
 * the slower save would silently erase the faster one.
 */

import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/auth";
import { todayIn } from "@/lib/dates";
import { getCategories, getExpense } from "@/lib/data/expenses";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseForm } from "@/components/expenses/expense-form";

export const metadata = { title: "Edit expense" };

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ householdId: string; expenseId: string }>;
}) {
  const { householdId, expenseId } = await params;
  const { user, role } = await requireMembership(householdId);

  const [household, expense, categories] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getExpense(householdId, expenseId),
    getCategories(householdId),
  ]);
  if (!household || !expense) notFound();

  // Same rule the database enforces in `can_modify_expense`. Rendering a 404
  // rather than a "forbidden" keeps this consistent with the rest of the app,
  // where an unauthorised URL is indistinguishable from one that does not exist.
  const canModify =
    expense.createdBy === user.id ||
    expense.payerId === user.id ||
    role === "owner" ||
    role === "admin";
  if (!canModify) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Edit expense</CardTitle>
      </CardHeader>
      <CardContent>
        <ExpenseForm
          householdId={householdId}
          currency={household.currency}
          members={household.members}
          categories={categories}
          viewerId={user.id}
          today={todayIn(household.timezone)}
          expense={expense}
        />
      </CardContent>
    </Card>
  );
}
