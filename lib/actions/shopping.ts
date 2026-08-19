"use server";

/**
 * Shopping list Server Actions.
 * =============================================================================
 * These write through Server Actions like everything else, but the UI does NOT
 * wait for them — see components/shopping/shopping-list.tsx. The list is used
 * standing in a supermarket aisle on a bad connection, where a tick that takes
 * 400ms to register gets tapped twice.
 *
 * That makes the actions here the authority and the client's optimistic state a
 * prediction. Two things follow, and both are deliberate:
 *
 *   Every action is idempotent. `toggleShoppingItem` is told the state to move
 *   TO rather than being asked to invert the current one, so replaying it lands
 *   in the same place. An "invert" would race with itself on a double-tap and
 *   leave the item in whichever state the last request happened to win.
 *
 *   None of them calls `revalidatePath`. A revalidation would push a full server
 *   render back over the same bad connection to correct state the client already
 *   has, and Realtime is already delivering the authoritative row to every
 *   device including this one.
 */

import { revalidatePath } from "next/cache";

import { getUser } from "@/lib/auth";
import { PARSE_FAILURE_MESSAGES, parseAmount } from "@/lib/domain/money";
import { computeSplits, remainderSeed } from "@/lib/domain/splits";
import { fromDatabaseError } from "@/lib/errors";
import { fail, failures, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";
import {
  addShoppingItemSchema,
  checkoutSchema,
  removeShoppingItemSchema,
  toggleShoppingItemSchema,
} from "@/lib/validation/shopping";

export async function addShoppingItem(
  input: unknown,
): Promise<ActionResult<{ itemId: string }>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = addShoppingItemSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", "Check the details below", toFieldErrors(parsed.error));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shopping_items")
    .insert({
      list_id: parsed.data.listId,
      // Set by `set_shopping_item_household` from the parent list anyway; sent
      // here because the INSERT policy's WITH CHECK reads the column.
      household_id: parsed.data.householdId,
      name: parsed.data.name,
      quantity: parsed.data.quantity ?? null,
      added_by: user.id,
    })
    .select("id")
    .single();

  if (error) return fromDatabaseError(error, "addShoppingItem");

  return ok({ itemId: data.id });
}

/**
 * Ticks or unticks an item.
 *
 * `checked_by` and `checked_at` move together — a CHECK constraint enforces that
 * they are either both set or both null — so unticking has to clear both.
 * Recording WHO ticked it is the difference between a list and a shared list:
 * it answers "did someone already grab this?" without anybody having to ask.
 */
export async function toggleShoppingItem(input: unknown): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = toggleShoppingItemSchema.safeParse(input);
  if (!parsed.success) return failures.validation("That item could not be found");

  const supabase = await createClient();
  const { error } = await supabase
    .from("shopping_items")
    .update(
      parsed.data.checked
        ? { checked_by: user.id, checked_at: new Date().toISOString() }
        : { checked_by: null, checked_at: null },
    )
    .eq("id", parsed.data.itemId);

  if (error) return fromDatabaseError(error, "toggleShoppingItem");

  return ok(undefined as never);
}

export async function removeShoppingItem(input: unknown): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = removeShoppingItemSchema.safeParse(input);
  if (!parsed.success) return failures.validation("That item could not be found");

  // A hard delete, unlike expenses. Nobody's balance depends on a shopping item,
  // there is no audit interest in a mistyped "mikl", and keeping tombstones
  // would mean the Realtime payload for a delete has to be distinguished from
  // an archive on every client.
  const supabase = await createClient();
  const { error } = await supabase
    .from("shopping_items")
    .delete()
    .eq("id", parsed.data.itemId);

  if (error) return fromDatabaseError(error, "removeShoppingItem");

  return ok(undefined as never);
}

/**
 * Turns the ticked items into a shared expense.
 *
 * This is the step that makes a shopping list worth having inside an expense
 * app rather than in a notes app: the person who paid stops being the person who
 * silently absorbs the cost. `checkout_shopping_items` does both halves in one
 * transaction — creating the expense and archiving the items — so a failure
 * cannot leave the items marked as bought with no expense to show for it.
 */
export async function checkoutShoppingItems(
  _previousState: ActionResult<{ expenseId: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ expenseId: string }>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = checkoutSchema.safeParse({
    householdId: formData.get("householdId"),
    itemIds: formData.get("itemIds"),
    amount: formData.get("amount"),
    payerId: formData.get("payerId"),
    categoryId: formData.get("categoryId") ?? undefined,
    spentAt: formData.get("spentAt"),
  });

  if (!parsed.success) {
    return fail("VALIDATION", "Check the details below", toFieldErrors(parsed.error));
  }

  const amount = parseAmount(parsed.data.amount);
  if (!amount.ok) {
    return fail("VALIDATION", "Check the details below", {
      amount: [PARSE_FAILURE_MESSAGES[amount.reason]],
    });
  }

  const supabase = await createClient();

  // Everyone currently in the household shares a supermarket run. Read here
  // rather than sent by the client so that a member who joined since the page
  // was rendered is included, and one who left is not.
  const { data: members, error: membersError } = await supabase
    .from("household_members")
    .select("user_id")
    .eq("household_id", parsed.data.householdId);

  if (membersError) return fromDatabaseError(membersError, "checkout members");
  if (!members?.length) return failures.businessRule("This household has no members");

  const split = computeSplits({
    totalMinor: amount.value,
    method: "equal",
    participants: members.map((member) => ({ userId: member.user_id })),
    seed: remainderSeed(amount.value),
  });

  if (!split.ok) return failures.businessRule(split.message);

  const { data, error } = await supabase.rpc("checkout_shopping_items", {
    p_item_ids: parsed.data.itemIds,
    p_payload: {
      household_id: parsed.data.householdId,
      payer_id: parsed.data.payerId,
      category_id: parsed.data.categoryId,
      description: "Shopping",
      amount_minor: amount.value,
      split_method: "equal",
      spent_at: parsed.data.spentAt,
      splits: split.splits.map((s) => ({
        user_id: s.userId,
        share_minor: s.shareMinor,
        share_input: s.shareInput,
      })),
    },
  });

  if (error) return fromDatabaseError(error, "checkout_shopping_items");
  if (!data) return failures.unknown();

  // The ledger genuinely did change, so unlike the other actions here this one
  // does revalidate — the balances and expense list are now stale.
  revalidatePath(`/app/households/${parsed.data.householdId}`);
  revalidatePath(`/app/households/${parsed.data.householdId}/expenses`);
  revalidatePath(`/app/households/${parsed.data.householdId}/shopping`);

  return ok({ expenseId: data });
}
