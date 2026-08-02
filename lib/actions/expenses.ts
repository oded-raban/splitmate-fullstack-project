"use server";

/**
 * Expense and settlement Server Actions.
 * =============================================================================
 * Same pipeline as lib/actions/households.ts — authenticate, validate,
 * authorize, persist, revalidate — with one addition that is specific to money:
 * the shares are COMPUTED HERE, on the server, from the method and the raw
 * inputs. The browser never gets to say what anyone's share is.
 *
 * That matters because a split is a claim about who owes what. If the client
 * submitted precomputed shares, a modified request could assign itself a share
 * of zero and the rest of the household the difference, and every total would
 * still add up. Recomputing from the method means the only thing a caller can
 * influence is the input the method is defined over.
 *
 * The database then checks the result independently: a deferred constraint
 * trigger refuses any expense whose splits do not sum to its total. Two
 * independent mechanisms have to agree before a row exists.
 */

import { revalidatePath } from "next/cache";

import { getUser } from "@/lib/auth";
import { PARSE_FAILURE_MESSAGES, parseAmount } from "@/lib/domain/money";
import { computeSplits } from "@/lib/domain/splits";
import { fromDatabaseError } from "@/lib/errors";
import { fail, failures, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";
import {
  createExpenseSchema,
  deleteExpenseSchema,
  settleUpSchema,
  updateExpenseSchema,
  voidSettlementSchema,
} from "@/lib/validation/expenses";

/**
 * Refreshes every route whose render depends on the ledger.
 *
 * Recording an expense changes the history, the balances on the household home
 * page, the settle-up suggestions and the activity feed. They are separate
 * routes but one fact, so they are invalidated together — leaving any of them
 * stale would show a member two different answers to "what do I owe?" depending
 * on which tab they were looking at.
 */
function revalidateLedger(householdId: string): void {
  revalidatePath(`/app/households/${householdId}`);
  revalidatePath(`/app/households/${householdId}/expenses`);
  revalidatePath(`/app/households/${householdId}/settle`);
}

/** Reads the shared expense fields out of a form. */
function readExpenseFields(formData: FormData) {
  return {
    householdId: formData.get("householdId"),
    description: formData.get("description"),
    amount: formData.get("amount"),
    payerId: formData.get("payerId"),
    categoryId: formData.get("categoryId") ?? undefined,
    spentAt: formData.get("spentAt"),
    splitMethod: formData.get("splitMethod"),
    participants: formData.get("participants"),
    note: formData.get("note") ?? undefined,
  };
}

export async function createExpense(
  _previousState: ActionResult<{ expenseId: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ expenseId: string }>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = createExpenseSchema.safeParse({
    ...readExpenseFields(formData),
    idempotencyKey: formData.get("idempotencyKey") ?? undefined,
  });

  if (!parsed.success) {
    return fail("VALIDATION", "Check the details below", toFieldErrors(parsed.error));
  }

  const input = parsed.data;

  const amount = parseAmount(input.amount);
  if (!amount.ok) {
    return fail("VALIDATION", "Check the details below", {
      amount: [PARSE_FAILURE_MESSAGES[amount.reason]],
    });
  }

  // The seed only affects which participants absorb an indivisible remainder.
  // Using the idempotency key means a retried submission allocates the leftover
  // agora to the same person as the first attempt, so a retry is genuinely
  // identical rather than merely equal in total.
  const split = computeSplits({
    totalMinor: amount.value,
    method: input.splitMethod,
    participants: input.participants,
    seed: input.idempotencyKey ?? `${input.description}:${amount.value}`,
  });

  if (!split.ok) {
    return fail("VALIDATION", split.message, { participants: [split.message] });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_expense_with_splits", {
    p_payload: {
      household_id: input.householdId,
      payer_id: input.payerId,
      category_id: input.categoryId,
      description: input.description,
      amount_minor: amount.value,
      split_method: input.splitMethod,
      spent_at: input.spentAt,
      note: input.note ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      splits: split.splits.map((s) => ({
        user_id: s.userId,
        share_minor: s.shareMinor,
        share_input: s.shareInput,
      })),
    },
  });

  if (error) return fromDatabaseError(error, "create_expense_with_splits");
  if (!data) return failures.unknown();

  revalidateLedger(input.householdId);
  return ok({ expenseId: data });
}

export async function updateExpense(
  _previousState: ActionResult<{ expenseId: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ expenseId: string }>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = updateExpenseSchema.safeParse({
    ...readExpenseFields(formData),
    expenseId: formData.get("expenseId"),
    expectedUpdatedAt: formData.get("expectedUpdatedAt"),
  });

  if (!parsed.success) {
    return fail("VALIDATION", "Check the details below", toFieldErrors(parsed.error));
  }

  const input = parsed.data;

  const amount = parseAmount(input.amount);
  if (!amount.ok) {
    return fail("VALIDATION", "Check the details below", {
      amount: [PARSE_FAILURE_MESSAGES[amount.reason]],
    });
  }

  // Seeded with the expense id so that re-saving an unchanged expense produces
  // byte-identical splits, and the revision history does not fill with entries
  // recording that a remainder moved between two people for no reason.
  const split = computeSplits({
    totalMinor: amount.value,
    method: input.splitMethod,
    participants: input.participants,
    seed: input.expenseId,
  });

  if (!split.ok) {
    return fail("VALIDATION", split.message, { participants: [split.message] });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_expense_with_splits", {
    p_expense_id: input.expenseId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_payload: {
      payer_id: input.payerId,
      category_id: input.categoryId,
      description: input.description,
      amount_minor: amount.value,
      split_method: input.splitMethod,
      spent_at: input.spentAt,
      note: input.note ?? null,
      splits: split.splits.map((s) => ({
        user_id: s.userId,
        share_minor: s.shareMinor,
        share_input: s.shareInput,
      })),
    },
  });

  if (error) {
    return fromDatabaseError(error, "update_expense_with_splits", {
      CONFLICT:
        "Someone else edited this expense while you were working on it. " +
        "Reopen it to see their version before saving again.",
    });
  }

  revalidateLedger(input.householdId);
  revalidatePath(`/app/households/${input.householdId}/expenses/${input.expenseId}`);
  return ok({ expenseId: input.expenseId });
}

/**
 * Removes an expense from the ledger without erasing it.
 *
 * Soft delete, because this is a financial record that other people have already
 * acted on. A roommate who transferred money on the strength of a balance is
 * entitled to see why that balance changed, and a hard delete would leave the
 * activity feed referring to a row that no longer exists.
 */
export async function deleteExpense(
  _previousState: ActionResult<never> | undefined,
  formData: FormData,
): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = deleteExpenseSchema.safeParse({
    householdId: formData.get("householdId"),
    expenseId: formData.get("expenseId"),
  });

  if (!parsed.success) return failures.validation("That expense could not be found");

  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_expense", {
    p_expense_id: parsed.data.expenseId,
  });

  if (error) return fromDatabaseError(error, "soft_delete_expense");

  revalidateLedger(parsed.data.householdId);
  return ok(undefined as never);
}

/**
 * Records that money actually moved between two members.
 *
 * SplitMate does not move money. This writes down that a real-world transfer
 * happened, which is why the method is a free label and why a settlement can be
 * voided rather than deleted: the claim "I paid you" is disputable, and the
 * ledger should show that it was made and withdrawn.
 */
export async function settleUp(
  _previousState: ActionResult<{ settlementId: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ settlementId: string }>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = settleUpSchema.safeParse({
    householdId: formData.get("householdId"),
    fromUserId: formData.get("fromUserId"),
    toUserId: formData.get("toUserId"),
    amount: formData.get("amount"),
    method: formData.get("method") ?? "other",
    note: formData.get("note") ?? undefined,
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

  if (parsed.data.fromUserId === parsed.data.toUserId) {
    return failures.businessRule("A payment needs two different people");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("settle_up", {
    p_household_id: parsed.data.householdId,
    p_from_user: parsed.data.fromUserId,
    p_to_user: parsed.data.toUserId,
    p_amount_minor: amount.value,
    p_method: parsed.data.method,
    // The generated signature types this as optional rather than nullable, so an
    // absent note is expressed by omitting it — passing null would be a type
    // error and, in Postgres, a different thing from "argument not supplied".
    p_note: parsed.data.note,
  });

  if (error) return fromDatabaseError(error, "settle_up");
  if (!data) return failures.unknown();

  revalidateLedger(parsed.data.householdId);
  return ok({ settlementId: data });
}

export async function voidSettlement(
  _previousState: ActionResult<never> | undefined,
  formData: FormData,
): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = voidSettlementSchema.safeParse({
    householdId: formData.get("householdId"),
    settlementId: formData.get("settlementId"),
  });

  if (!parsed.success) return failures.validation("That payment could not be found");

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_settlement", {
    p_settlement_id: parsed.data.settlementId,
  });

  if (error) return fromDatabaseError(error, "void_settlement");

  revalidateLedger(parsed.data.householdId);
  return ok(undefined as never);
}
