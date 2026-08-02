"use server";

/**
 * Member management Server Actions.
 * =============================================================================
 * Removing someone from a household and changing what they are allowed to do are
 * the two operations here. Both are gated on role in this file for the sake of a
 * readable message, and gated again by RLS in the database for the sake of being
 * correct.
 */

import { revalidatePath } from "next/cache";

import { getUser } from "@/lib/auth";
import { fromDatabaseError } from "@/lib/errors";
import { fail, failures, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { changeRoleSchema, memberSchema } from "@/lib/validation/households";

/**
 * Promotes a member to admin, or demotes an admin to member.
 *
 * Owner is not reachable through this action — `assignableRoleSchema` excludes
 * it — because becoming the owner means the previous owner stops being one, and
 * that exchange has to happen atomically. See `transferOwnership`.
 */
export async function changeMemberRole(formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = changeRoleSchema.safeParse({
    householdId: formData.get("householdId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return fail("VALIDATION", "That role isn't valid.");

  const { householdId, userId, role } = parsed.data;

  if (userId === user.id) {
    return fail("BUSINESS_RULE", "You can't change your own role.");
  }

  const supabase = await createClient();

  // Guard against demoting the owner: they are the only member whose role this
  // action must never touch, and the partial unique index would not stop it
  // (dropping to zero owners violates no index).
  const { data: target, error: targetError } = await supabase
    .from("household_members")
    .select("role")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();

  if (targetError) return fromDatabaseError(targetError, "changeMemberRole lookup");
  if (!target) return failures.notFound("That member");

  if (target.role === "owner") {
    return fail(
      "BUSINESS_RULE",
      "The owner's role can't be changed here. Transfer ownership instead.",
    );
  }

  // Selecting the row back is what distinguishes "updated" from "rejected by
  // RLS": a policy failure on UPDATE matches zero rows rather than erroring.
  const { data, error } = await supabase
    .from("household_members")
    .update({ role })
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();

  if (error) return fromDatabaseError(error, "changeMemberRole");
  if (!data) return failures.forbidden("change roles in this household");

  revalidatePath(`/app/households/${householdId}/members`);
  return ok();
}

/**
 * Removes someone from a household.
 *
 * Blocked while they have a non-zero balance, for the same reason leaving is:
 * their expenses and splits remain in the ledger after their membership row is
 * gone, so removing them mid-debt leaves the household's balances no longer
 * summing to zero and no way for anyone to settle with them.
 */
export async function removeMember(formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = memberSchema.safeParse({
    householdId: formData.get("householdId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) return failures.notFound("That member");

  const { householdId, userId } = parsed.data;

  if (userId === user.id) {
    return fail("BUSINESS_RULE", "To remove yourself, use “Leave household”.");
  }

  const supabase = await createClient();

  const { data: target, error: targetError } = await supabase
    .from("household_members")
    .select("role")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();

  if (targetError) return fromDatabaseError(targetError, "removeMember lookup");
  if (!target) return failures.notFound("That member");

  if (target.role === "owner") {
    return fail(
      "BUSINESS_RULE",
      "The owner can't be removed from their own household.",
    );
  }

  const { data: balances, error: balanceError } = await supabase.rpc(
    "get_household_balances",
    { p_household_id: householdId },
  );

  if (balanceError) return fromDatabaseError(balanceError, "removeMember balances");

  const theirs = balances?.find((balance) => balance.user_id === userId);
  if (theirs && theirs.net !== 0) {
    return fail(
      "BUSINESS_RULE",
      theirs.net > 0
        ? "They're still owed money in this household. Settle up before removing them."
        : "They still owe money in this household. Settle up before removing them.",
    );
  }

  const { data, error } = await supabase
    .from("household_members")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();

  if (error) return fromDatabaseError(error, "removeMember");
  if (!data) return failures.forbidden("remove members from this household");

  revalidatePath(`/app/households/${householdId}/members`);
  return ok();
}

/**
 * Hands the household over to another member.
 *
 * Delegated to an RPC because it is two updates that must be one: a partial
 * unique index permits exactly one owner, so promoting before demoting violates
 * it, and demoting before promoting leaves the household ownerless if the second
 * statement fails. Inside the function both run in a single transaction.
 */
export async function transferOwnership(formData: FormData): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = memberSchema.safeParse({
    householdId: formData.get("householdId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) return failures.notFound("That member");

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_ownership", {
    p_household_id: parsed.data.householdId,
    p_new_owner_id: parsed.data.userId,
  });

  if (error) return fromDatabaseError(error, "transferOwnership");

  revalidatePath(`/app/households/${parsed.data.householdId}`, "layout");
  return ok();
}
