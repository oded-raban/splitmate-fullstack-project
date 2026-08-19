/**
 * Scheduled job: turn due recurring rules into expenses.
 * =============================================================================
 * Runs daily (vercel.json). This is the ONLY place in the application that uses
 * the service-role client, and the reason is structural rather than convenient:
 * a timer has no signed-in user, so `auth.uid()` is null and every RLS policy
 * correctly refuses the request — yet the job must write into households that
 * nobody is currently looking at.
 *
 * BECAUSE IT BYPASSES RLS, THE ENDPOINT ITSELF IS THE SECURITY BOUNDARY
 * A route that can write an expense into any household, reachable by anyone who
 * knows the URL, would be a straightforward way to corrupt every ledger in the
 * system. Three things prevent that:
 *
 *   1. A bearer token compared against CRON_SECRET, which the env schema
 *      requires to be at least 16 characters.
 *   2. A timing-safe comparison, so the token cannot be recovered a byte at a
 *      time by measuring how long a rejection takes.
 *   3. `force-dynamic` and `maxDuration`, so the response is never cached and a
 *      long run is not truncated halfway through a household.
 *
 * WHY THE SPLIT MATH HAPPENS HERE AND NOT IN SQL
 * `lib/domain/splits.ts` is the single definition of how money is divided in
 * this system, and a second implementation in PL/pgSQL would drift from it. So
 * this route reads the due rules, computes shares with the same function the
 * expense form uses, and hands them to `generate_recurring_expense`, which
 * stores them atomically and advances the schedule.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { asMinor } from "@/lib/domain/money";
import { computeSplits, remainderSeed } from "@/lib/domain/splits";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

// Never prerendered or cached: it has side effects and must observe the clock.
export const dynamic = "force-dynamic";

// Vercel's default is 10s. A household with many rules can exceed that, and a
// job killed mid-run leaves some rules fired and others not — which the
// idempotency key makes safe to retry, but is still better avoided.
export const maxDuration = 60;

/**
 * Constant-time bearer token check.
 *
 * `===` on strings returns as soon as two bytes differ, so the time it takes to
 * reject reveals how many leading characters were right — enough to recover the
 * secret one character at a time. `timingSafeEqual` always compares the whole
 * buffer. It throws on length mismatch, so length is checked separately (the
 * length of the secret is not itself sensitive).
 */
function isAuthorised(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);

  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

export async function GET(request: NextRequest) {
  const { CRON_SECRET } = serverEnv();

  if (!isAuthorised(request.headers.get("authorization"), CRON_SECRET)) {
    // 401 with no detail. Explaining why the token was rejected would help an
    // attacker more than it helps the operator, who has the logs.
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // Every rule that is due, across every household. `idx_recurring_due` is a
  // partial index on exactly this predicate, so it stays a cheap index scan as
  // the number of households grows rather than a full table scan.
  const { data: rules, error } = await supabase
    .from("recurring_expenses")
    .select("id, household_id, amount_minor, split_method, split_config")
    .eq("is_active", true)
    .lte("next_run_at", today);

  if (error) {
    console.error("[cron] could not read due rules", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const results = { generated: 0, skipped: 0, failed: 0 };

  for (const rule of rules ?? []) {
    // Read per rule rather than once, because each rule belongs to a different
    // household and shares must reflect who is in it TODAY — not who was in it
    // when somebody set the rule up months ago.
    const { data: members, error: membersError } = await supabase
      .from("household_members")
      .select("user_id")
      .eq("household_id", rule.household_id);

    if (membersError || !members?.length) {
      console.error("[cron] no members for rule", rule.id, membersError?.message);
      results.skipped += 1;
      continue;
    }

    const amountMinor = asMinor(rule.amount_minor);

    const split = computeSplits({
      totalMinor: amountMinor,
      method: "equal",
      participants: members.map((member) => ({ userId: member.user_id })),
      seed: remainderSeed(amountMinor),
    });

    if (!split.ok) {
      console.error("[cron] could not split rule", rule.id, split.message);
      results.skipped += 1;
      continue;
    }

    const { error: rpcError } = await supabase.rpc("generate_recurring_expense", {
      p_rule_id: rule.id,
      p_splits: split.splits.map((s) => ({
        user_id: s.userId,
        share_minor: s.shareMinor,
        share_input: s.shareInput,
      })),
    });

    if (rpcError) {
      // Logged and stepped over rather than thrown. One malformed rule must not
      // stop every other household's rent from being recorded, and the failure
      // is safe to retry tomorrow because the rule's schedule only advances on
      // success.
      console.error("[cron] rule failed", rule.id, rpcError.message);
      results.failed += 1;
      continue;
    }

    results.generated += 1;
  }

  // `info` rather than `log`: this is the job's only success signal, and it is
  // what an operator greps for to confirm the schedule is alive.
  console.info(
    `[cron] recurring: ${results.generated} generated, ` +
      `${results.skipped} skipped, ${results.failed} failed`,
  );

  return NextResponse.json({ ok: true, ...results });
}
