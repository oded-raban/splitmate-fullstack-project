/**
 * Recurring rules: RLS on rule management, and the cron RPC's double-run and
 * privilege guards.
 * =============================================================================
 * `generate_recurring_expense` is revoked from `authenticated` entirely (see
 * the comment on it in the migration) — the only caller that can reach it is
 * the service-role key the cron route holds. The first test below is the
 * negative case that makes that revocation worth having: it proves a
 * signed-in household member, even an owner, cannot call it directly.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { admin, cleanupTestUsers, testUser } from "./helpers";

afterAll(cleanupTestUsers);

interface Fixture {
  householdId: string;
  owner: Awaited<ReturnType<typeof testUser>>;
  member: Awaited<ReturnType<typeof testUser>>;
  ruleId: string;
}

let f: Fixture;

beforeAll(async () => {
  const [owner, member] = await Promise.all([testUser("owner"), testUser("member")]);
  const { data: householdId } = await owner.client.rpc("create_household", {
    p_name: "Recurring Household",
  });
  await admin
    .from("household_members")
    .insert({ household_id: householdId!, user_id: member.id, role: "member" });

  const { data: rule, error } = await owner.client
    .from("recurring_expenses")
    .insert({
      household_id: householdId!,
      payer_id: owner.id,
      description: "Rent",
      amount_minor: 400_000,
      split_method: "equal",
      split_config: [{ user_id: owner.id, input: null }],
      frequency: "monthly",
      day_of_period: 1,
      next_run_at: "2026-08-01",
      created_by: owner.id,
    })
    .select("id")
    .single();
  if (error) throw error;

  f = { householdId: householdId!, owner, member, ruleId: rule.id };
});

describe("recurring_expenses RLS", () => {
  it("lets a plain member read the schedule (transparency)", async () => {
    const { data, error } = await f.member.client
      .from("recurring_expenses")
      .select("id")
      .eq("household_id", f.householdId);
    expect(error).toBeNull();
    expect(data?.some((row) => row.id === f.ruleId)).toBe(true);
  });

  it("refuses a plain member creating a rule", async () => {
    const { error } = await f.member.client.from("recurring_expenses").insert({
      household_id: f.householdId,
      payer_id: f.member.id,
      description: "Sneaky subscription",
      amount_minor: 10_000,
      split_method: "equal",
      split_config: [{ user_id: f.member.id, input: null }],
      frequency: "monthly",
      day_of_period: 1,
      next_run_at: "2026-08-01",
      created_by: f.member.id,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a plain member pausing or deleting the owner's rule", async () => {
    const { error: updateError } = await f.member.client
      .from("recurring_expenses")
      .update({ is_active: false })
      .eq("id", f.ruleId);
    expect(updateError).toBeNull(); // no error, but...

    const { data: stillActive } = await admin
      .from("recurring_expenses")
      .select("is_active")
      .eq("id", f.ruleId)
      .single();
    expect(stillActive?.is_active).toBe(true); // ...zero rows were actually changed.

    const { error: deleteError } = await f.member.client
      .from("recurring_expenses")
      .delete()
      .eq("id", f.ruleId);
    expect(deleteError).toBeNull();

    const { data: stillThere } = await admin
      .from("recurring_expenses")
      .select("id")
      .eq("id", f.ruleId)
      .maybeSingle();
    expect(stillThere).not.toBeNull();
  });
});

describe("generate_recurring_expense", () => {
  it("is not callable by an authenticated household owner", async () => {
    const { error } = await f.owner.client.rpc("generate_recurring_expense", {
      p_rule_id: f.ruleId,
      p_splits: [{ user_id: f.owner.id, share_minor: 400_000 }],
    });
    expect(error).not.toBeNull();
  });

  it("materialises exactly one expense when 'run' twice for the same due date", async () => {
    const splits = [
      { user_id: f.owner.id, share_minor: 200_000 },
      { user_id: f.member.id, share_minor: 200_000 },
    ];

    const first = await admin.rpc("generate_recurring_expense", {
      p_rule_id: f.ruleId,
      p_splits: splits,
    });
    expect(first.error).toBeNull();

    // Reset next_run_at to simulate the cron retrying the same due date after
    // a failure partway through, before the schedule was allowed to advance —
    // the exact scenario the idempotency key defends against.
    await admin
      .from("recurring_expenses")
      .update({ next_run_at: "2026-08-01" })
      .eq("id", f.ruleId);

    const second = await admin.rpc("generate_recurring_expense", {
      p_rule_id: f.ruleId,
      p_splits: splits,
    });
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    const { count } = await admin
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("recurring_id", f.ruleId);
    expect(count).toBe(1);
  });

  it("refuses to fire a paused rule", async () => {
    await admin
      .from("recurring_expenses")
      .update({ is_active: false })
      .eq("id", f.ruleId);

    const { error } = await admin.rpc("generate_recurring_expense", {
      p_rule_id: f.ruleId,
      p_splits: [{ user_id: f.owner.id, share_minor: 400_000 }],
    });
    expect(error).not.toBeNull();
  });
});
