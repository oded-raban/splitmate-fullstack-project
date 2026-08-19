"use server";

/**
 * Server Actions for recurring expense rules.
 * =============================================================================
 * A rule stores its split as a METHOD plus a CONFIG, not as a set of computed
 * shares. The difference matters when the household changes: a rule that stored
 * "150.00 each for Dana, Yonatan and Noa" would keep charging a person who moved
 * out, and would never charge the one who moved in. Storing "split equally"
 * instead means the shares are recomputed against the membership as it stands on
 * the day the rule fires — which is what "split the rent equally" has always
 * meant to the people saying it.
 */

import { revalidatePath } from "next/cache";

import { getUser } from "@/lib/auth";
import { firstRunOnOrAfter } from "@/lib/domain/recurring";
import { PARSE_FAILURE_MESSAGES, parseAmount } from "@/lib/domain/money";
import { fromDatabaseError } from "@/lib/errors";
import { fail, failures, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";
import {
  deleteRuleSchema,
  recurringRuleSchema,
  toggleRuleSchema,
} from "@/lib/validation/recurring";

export async function createRecurringRule(
  _previousState: ActionResult<{ ruleId: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ ruleId: string }>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = recurringRuleSchema.safeParse({
    householdId: formData.get("householdId"),
    description: formData.get("description"),
    amount: formData.get("amount"),
    payerId: formData.get("payerId"),
    categoryId: formData.get("categoryId") ?? undefined,
    frequency: formData.get("frequency"),
    dayOfPeriod: formData.get("dayOfPeriod"),
    startsOn: formData.get("startsOn"),
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

  const { data, error } = await supabase
    .from("recurring_expenses")
    .insert({
      household_id: parsed.data.householdId,
      description: parsed.data.description,
      amount_minor: amount.value,
      category_id: parsed.data.categoryId,
      payer_id: parsed.data.payerId,
      split_method: "equal",
      // Empty because "equal" needs no per-person input. The column exists for
      // the methods that do, and the shape matches what `computeSplits` reads.
      split_config: [],
      frequency: parsed.data.frequency,
      day_of_period: parsed.data.dayOfPeriod,
      next_run_at: firstRunOnOrAfter(
        parsed.data.startsOn,
        parsed.data.frequency,
        parsed.data.dayOfPeriod,
      ),
      created_by: user.id,
    })
    .select("id")
    .single();

  // Owner/admin is enforced by `recurring_insert`, so a member attempting this
  // gets a policy violation translated into a readable refusal rather than a
  // permission check duplicated here.
  if (error) return fromDatabaseError(error, "createRecurringRule");

  revalidatePath(`/app/households/${parsed.data.householdId}/recurring`);

  return ok({ ruleId: data.id });
}

/**
 * Pauses or resumes a rule.
 *
 * Pausing rather than deleting is the safe default for "we are not paying for
 * Netflix this month". Deleting loses the amount, the payer and the schedule,
 * all of which have to be retyped correctly to undo a change that was meant to
 * be temporary.
 */
export async function toggleRecurringRule(
  input: unknown,
): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = toggleRuleSchema.safeParse(input);
  if (!parsed.success) return failures.validation("That rule could not be found");

  const supabase = await createClient();
  const { error } = await supabase
    .from("recurring_expenses")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.ruleId)
    .eq("household_id", parsed.data.householdId);

  if (error) return fromDatabaseError(error, "toggleRecurringRule");

  revalidatePath(`/app/households/${parsed.data.householdId}/recurring`);

  return ok(undefined as never);
}

export async function deleteRecurringRule(
  input: unknown,
): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = deleteRuleSchema.safeParse(input);
  if (!parsed.success) return failures.validation("That rule could not be found");

  // The expenses this rule already generated survive: `expenses.recurring_id` is
  // ON DELETE SET NULL. Deleting a rule stops the future, it does not rewrite
  // the past — balances that people have already settled against must not move.
  const supabase = await createClient();
  const { error } = await supabase
    .from("recurring_expenses")
    .delete()
    .eq("id", parsed.data.ruleId)
    .eq("household_id", parsed.data.householdId);

  if (error) return fromDatabaseError(error, "deleteRecurringRule");

  revalidatePath(`/app/households/${parsed.data.householdId}/recurring`);

  return ok(undefined as never);
}
