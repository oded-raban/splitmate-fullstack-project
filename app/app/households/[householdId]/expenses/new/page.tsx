/**
 * Record a new expense.
 * =============================================================================
 * A Server Component that gathers what the form needs — members, categories, the
 * household's currency — and hands them to the one Client Component on the page.
 * The form is interactive by necessity (a live split preview cannot be computed
 * on the server), but the data it works from arrives already resolved, so there
 * is no loading state between opening the page and being able to type.
 */

import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/auth";
import { todayIn } from "@/lib/dates";
import { getCategories } from "@/lib/data/expenses";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseForm } from "@/components/expenses/expense-form";

export const metadata = { title: "Add expense" };

export default async function NewExpensePage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const { user } = await requireMembership(householdId);

  const [household, categories] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getCategories(householdId),
  ]);
  if (!household) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add an expense</CardTitle>
      </CardHeader>
      <CardContent>
        <ExpenseForm
          householdId={householdId}
          currency={household.currency}
          members={household.members}
          categories={categories}
          viewerId={user.id}
          today={todayIn(household.timezone)}
        />
      </CardContent>
    </Card>
  );
}
