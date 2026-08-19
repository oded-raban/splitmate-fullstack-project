/**
 * Reads for the shopping list.
 * =============================================================================
 * A household gets one list, created for it by `create_household`. The schema
 * supports several — `shopping_items.list_id` is a real foreign key — but the
 * UI deliberately exposes only the first: a household of four does not need list
 * management, and offering it would add a navigation level in front of the one
 * screen people actually want.
 */

import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { asMinor, type Minor } from "@/lib/domain/money";

export interface ShoppingItemRow {
  id: string;
  name: string;
  quantity: string | null;
  estimatedMinor: Minor | null;
  addedBy: string;
  checkedBy: string | null;
  checkedAt: string | null;
  position: number;
  createdAt: string;
}

export interface ShoppingListData {
  listId: string;
  name: string;
  items: ShoppingItemRow[];
}

/**
 * The household's active shopping list.
 *
 * Archived items are excluded: once a run has been checked out into an expense
 * the items are history, and leaving them in place would mean the list grows
 * without bound and every shop starts with unticking last week's.
 */
export async function getShoppingList(
  householdId: string,
): Promise<ShoppingListData | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();

  const { data: list, error: listError } = await supabase
    .from("shopping_lists")
    .select("id, name")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (listError || !list) {
    if (listError) console.error("[data] getShoppingList failed", listError.message);
    return null;
  }

  const { data: items, error: itemsError } = await supabase
    .from("shopping_items")
    .select(
      "id, name, quantity, estimated_minor, added_by, checked_by, checked_at, position, created_at",
    )
    .eq("list_id", list.id)
    .is("archived_at", null)
    // Unchecked first, then oldest first. Ticked items sink rather than vanish,
    // so someone can see what has already been picked up without losing the
    // ability to untick a mistake.
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (itemsError) {
    console.error("[data] getShoppingList items failed", itemsError.message);
    return { listId: list.id, name: list.name, items: [] };
  }

  return {
    listId: list.id,
    name: list.name,
    items: (items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      estimatedMinor:
        item.estimated_minor === null ? null : asMinor(item.estimated_minor),
      addedBy: item.added_by,
      checkedBy: item.checked_by,
      checkedAt: item.checked_at,
      position: item.position,
      createdAt: item.created_at,
    })),
  };
}
