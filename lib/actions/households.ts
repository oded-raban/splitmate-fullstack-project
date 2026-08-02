"use server";

/**
 * Household lifecycle Server Actions.
 * =============================================================================
 * Each action follows the same pipeline, in this order and for these reasons:
 *
 *   1. authenticate — `getUser()`, which verifies the token rather than reading
 *      an attacker-supplied cookie
 *   2. validate     — Zod parse of raw input; nothing below may assume shape
 *   3. authorize    — the affordance check, so the user gets a clear message
 *                     instead of a bare rejection
 *   4. persist      — the write, where RLS performs the authorization that
 *                     actually counts
 *   5. revalidate   — invalidate the cached render of affected routes
 *
 * Step 3 is not what keeps data safe; step 4 is. If every check in this file
 * were deleted, the database would still refuse each of these writes to a user
 * who has no business making them. The checks exist so the refusal is legible.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";
import { fromDatabaseError } from "@/lib/errors";
import { fail, failures, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";
import {
  createHouseholdSchema,
  householdIdSchema,
  updateHouseholdSchema,
} from "@/lib/validation/households";

/**
 * Creates a household and makes the caller its owner.
 *
 * The work happens in the `create_household` RPC rather than in four statements
 * here, because creating a household is atomic by nature: it is the household
 * row, the owner membership, eight default categories and a shopping list. Doing
 * that from the application would leave a household with no owner — invisible to
 * everyone including its creator, since every RLS policy consults membership —
 * if the process died between the first and second insert.
 *
 * Shaped for `useActionState`, hence the leading previous-state parameter.
 */
export async function createHousehold(
  _previousState: ActionResult<{ householdId: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ householdId: string }>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = createHouseholdSchema.safeParse({
    name: formData.get("name"),
    currency: formData.get("currency") ?? undefined,
  });

  if (!parsed.success) {
    return fail("VALIDATION", "Check the details below", toFieldErrors(parsed.error));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_household", {
    p_name: parsed.data.name,
    p_currency: parsed.data.currency,
  });

  if (error) return fromDatabaseError(error, "create_household");
  if (!data) return failures.unknown();

  revalidatePath("/app", "layout");

  // Outside the error branch on purpose: `redirect()` signals by throwing, so
  // placing it inside a try/catch above would have the catch swallow it.
  redirect(`/app/households/${data}`);
}

/** Renames a household. Admins and owners only; RLS enforces the same rule. */
export async function updateHousehold(
  _previousState: ActionResult<{ name: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ name: string }>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = updateHouseholdSchema.safeParse({
    householdId: formData.get("householdId"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return fail("VALIDATION", "Check the details below", toFieldErrors(parsed.error));
  }

  const { householdId, name } = parsed.data;
  const supabase = await createClient();

  // `select()` after the update is what makes an RLS rejection detectable: a
  // policy failure on UPDATE is not an error, it simply matches no rows. Without
  // asking for the updated row back, a forbidden rename would report success.
  const { data, error } = await supabase
    .from("households")
    .update({ name })
    .eq("id", householdId)
    .select("id, name")
    .maybeSingle();

  if (error) return fromDatabaseError(error, "updateHousehold");
  if (!data) return failures.forbidden("rename this household");

  revalidatePath("/app", "layout");
  revalidatePath(`/app/households/${householdId}`, "layout");

  return ok({ name: data.name });
}

/**
 * Leaves a household.
 *
 * Two rules are enforced here rather than in the database, because both need to
 * explain themselves:
 *
 *   • The owner cannot leave. Every household must have exactly one owner (a
 *     partial unique index guarantees at most one; this rule preserves at least
 *     one), so the owner must hand over first. The database would report this as
 *     a policy failure with no indication of what to do about it.
 *
 *   • A member with an unsettled balance cannot leave. Their share of the
 *     ledger does not vanish when their membership does — it would leave the
 *     remaining members with expenses split against someone who is gone, and
 *     balances that no longer sum to zero. Settling first is the only honest
 *     resolution.
 */
export async function leaveHousehold(formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = householdIdSchema.safeParse({
    householdId: formData.get("householdId"),
  });
  if (!parsed.success) return failures.notFound("That household");

  const { householdId } = parsed.data;
  const supabase = await createClient();

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("role")
    .eq("household_id", householdId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError)
    return fromDatabaseError(membershipError, "leaveHousehold lookup");
  if (!membership) return failures.notFound("That household");

  if (membership.role === "owner") {
    return fail(
      "BUSINESS_RULE",
      "You own this household, so you can't leave it. Make someone else the owner first, or delete the household.",
    );
  }

  const { data: balances, error: balanceError } = await supabase.rpc(
    "get_household_balances",
    { p_household_id: householdId },
  );

  if (balanceError) return fromDatabaseError(balanceError, "leaveHousehold balances");

  const own = balances?.find((balance) => balance.user_id === user.id);
  if (own && own.net !== 0) {
    return fail(
      "BUSINESS_RULE",
      own.net > 0
        ? "You're still owed money in this household. Settle up before you leave."
        : "You still owe money in this household. Settle up before you leave.",
    );
  }

  const { error } = await supabase
    .from("household_members")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", user.id);

  if (error) return fromDatabaseError(error, "leaveHousehold");

  revalidatePath("/app", "layout");
  return ok();
}
