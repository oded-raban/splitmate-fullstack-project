/**
 * Shopping.
 * =============================================================================
 * A Server Component that resolves the list and hands it to the one Client
 * Component that needs to hold a WebSocket open. The first paint is fully
 * rendered on the server, so the list is readable before any JavaScript has run
 * — which matters on the connection this screen is actually used on.
 */

import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/auth";
import { todayIn } from "@/lib/dates";
import { getCategories } from "@/lib/data/expenses";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { getShoppingList } from "@/lib/data/shopping";
import { ShoppingList } from "@/components/shopping/shopping-list";

export const metadata = { title: "Shopping" };

export default async function ShoppingPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const { user } = await requireMembership(householdId);

  const [household, list, categories] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getShoppingList(householdId),
    getCategories(householdId),
  ]);

  if (!household || !list) notFound();

  return (
    <ShoppingList
      householdId={householdId}
      listId={list.listId}
      currency={household.currency}
      initialItems={list.items}
      members={household.members}
      categories={categories}
      viewerId={user.id}
      today={todayIn(household.timezone)}
    />
  );
}
