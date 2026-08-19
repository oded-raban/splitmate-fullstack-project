/**
 * Reads for recurring expense rules.
 * =============================================================================
 * Every member can see the rules — `recurring_select` allows it — even though
 * only owners and admins can change them. That asymmetry is deliberate: a rule
 * silently adding rent to your balance every month is precisely the thing you
 * should be able to inspect without needing permission to.
 */

import { getUser } from "@/lib/auth";
import { asMinor, type Minor } from "@/lib/domain/money";
import { createClient } from "@/lib/supabase/server";
import type { RecurrenceFrequency, SplitMethod } from "@/lib/supabase/types";

export interface RecurringRule {
  id: string;
  description: string;
  amountMinor: Minor;
  payerId: string;
  categoryId: string | null;
  categoryName: string | null;
  splitMethod: SplitMethod;
  frequency: RecurrenceFrequency;
  dayOfPeriod: number;
  nextRunAt: string;
  lastRunAt: string | null;
  isActive: boolean;
}

export async function getRecurringRules(householdId: string): Promise<RecurringRule[]> {
  const user = await getUser();
  if (!user) return [];

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recurring_expenses")
    .select(
      `id, description, amount_minor, payer_id, category_id, split_method,
       frequency, day_of_period, next_run_at, last_run_at, is_active,
       categories ( name )`,
    )
    .eq("household_id", householdId)
    // Active first, then soonest. A paused rule is still worth showing — it is
    // the answer to "why did rent stop appearing?" — but it belongs below the
    // ones that are going to fire.
    .order("is_active", { ascending: false })
    .order("next_run_at", { ascending: true });

  if (error) {
    console.error("[data] getRecurringRules failed", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    description: row.description,
    amountMinor: asMinor(row.amount_minor),
    payerId: row.payer_id,
    categoryId: row.category_id,
    categoryName: row.categories?.name ?? null,
    splitMethod: row.split_method,
    frequency: row.frequency,
    dayOfPeriod: row.day_of_period,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    isActive: row.is_active,
  }));
}
