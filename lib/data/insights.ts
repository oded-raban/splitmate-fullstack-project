/**
 * Reads for the insights page.
 * =============================================================================
 * Both aggregations run in Postgres, via `get_monthly_breakdown` and
 * `get_member_stats`. That placement is the whole design: the alternative is
 * fetching every expense and every split into the server and reducing them in
 * JavaScript, which transfers a year of the household's ledger over the wire to
 * produce about two hundred bytes of chart data — and gets linearly worse as the
 * household accumulates history, which is exactly the direction it goes.
 *
 * Both functions are SECURITY INVOKER, so RLS still applies. A non-member calling
 * them gets empty results rather than an error, because the policies filter rows
 * rather than refusing the query.
 */

import { getUser } from "@/lib/auth";
import { asMinor, type Minor } from "@/lib/domain/money";
import { createClient } from "@/lib/supabase/server";

export interface CategoryTotal {
  categoryId: string | null;
  categoryName: string;
  totalMinor: Minor;
  expenseCount: number;
}

export interface MonthTotal {
  /** ISO date of the first of the month, e.g. "2026-07-01". */
  month: string;
  totalMinor: Minor;
  categories: CategoryTotal[];
}

export interface MemberStat {
  userId: string;
  paidMinor: Minor;
  consumedMinor: Minor;
  expenseCount: number;
}

export interface InsightsData {
  months: MonthTotal[];
  categories: CategoryTotal[];
  members: MemberStat[];
  totalMinor: Minor;
  from: string;
  to: string;
}

/**
 * Spending for the given window, grouped both ways.
 *
 * The RPC returns one row per month per category — the finest grouping either
 * chart needs — and this rolls it up into the two shapes the page renders. Doing
 * it here rather than issuing two RPCs keeps it to a single round trip and
 * guarantees the two charts cannot disagree about the total, which they could if
 * an expense were written between two separate queries.
 */
export async function getInsights(
  householdId: string,
  from: string,
  to: string,
): Promise<InsightsData | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();

  const [breakdown, stats] = await Promise.all([
    supabase.rpc("get_monthly_breakdown", {
      p_household_id: householdId,
      p_from: from,
      p_to: to,
    }),
    supabase.rpc("get_member_stats", {
      p_household_id: householdId,
      p_from: from,
      p_to: to,
    }),
  ]);

  if (breakdown.error) {
    console.error("[data] get_monthly_breakdown failed", breakdown.error.message);
    return null;
  }

  if (stats.error) {
    console.error("[data] get_member_stats failed", stats.error.message);
    return null;
  }

  const rows = breakdown.data ?? [];

  const byMonth = new Map<string, MonthTotal>();
  const byCategory = new Map<string, CategoryTotal>();
  let total = 0;

  for (const row of rows) {
    const amount = Number(row.total_minor);
    const count = Number(row.expense_count);
    total += amount;

    // Postgres returns `date` as a full ISO timestamp in some driver versions
    // and as a bare date in others. Truncating makes the key stable either way.
    const month = row.month.slice(0, 10);

    const existingMonth = byMonth.get(month);
    const category: CategoryTotal = {
      categoryId: row.category_id,
      categoryName: row.category_name,
      totalMinor: asMinor(amount),
      expenseCount: count,
    };

    if (existingMonth) {
      existingMonth.totalMinor = asMinor(existingMonth.totalMinor + amount);
      existingMonth.categories.push(category);
    } else {
      byMonth.set(month, {
        month,
        totalMinor: asMinor(amount),
        categories: [category],
      });
    }

    // Uncategorised expenses all share a null id, so the name is the key.
    const categoryKey = row.category_id ?? row.category_name;
    const existingCategory = byCategory.get(categoryKey);

    if (existingCategory) {
      existingCategory.totalMinor = asMinor(existingCategory.totalMinor + amount);
      existingCategory.expenseCount += count;
    } else {
      byCategory.set(categoryKey, { ...category });
    }
  }

  return {
    // Ascending, because a time axis that runs right to left is a chart nobody
    // reads correctly. The RPC returns newest first for list use.
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    categories: [...byCategory.values()].sort((a, b) => b.totalMinor - a.totalMinor),
    members: (stats.data ?? []).map((row) => ({
      userId: row.user_id,
      paidMinor: asMinor(Number(row.paid_minor)),
      consumedMinor: asMinor(Number(row.consumed_minor)),
      expenseCount: Number(row.expense_count),
    })),
    totalMinor: asMinor(total),
    from,
    to,
  };
}
