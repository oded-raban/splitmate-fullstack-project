/**
 * Analytics aggregations: totals returned by the database must agree with the
 * sum of the individual expenses that produced them, and must obey RLS the
 * same as everything else.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { admin, cleanupTestUsers, testUser } from "./helpers";

afterAll(cleanupTestUsers);

interface Fixture {
  householdId: string;
  owner: Awaited<ReturnType<typeof testUser>>;
  member: Awaited<ReturnType<typeof testUser>>;
  outsider: Awaited<ReturnType<typeof testUser>>;
  categoryId: string;
  spentAt: string;
}

let f: Fixture;

beforeAll(async () => {
  const [owner, member, outsider] = await Promise.all([
    testUser("owner"),
    testUser("member"),
    testUser("outsider"),
  ]);
  const { data: householdId } = await owner.client.rpc("create_household", {
    p_name: "Insights Household",
  });
  await admin
    .from("household_members")
    .insert({ household_id: householdId!, user_id: member.id, role: "member" });

  const { data: categories } = await admin
    .from("categories")
    .select("id, name")
    .eq("household_id", householdId!);
  const categoryId =
    categories?.find((c) => c.name === "Groceries")?.id ?? categories![0]!.id;

  const spentAt = "2026-08-15";
  const amounts = [12_345, 6_780, 30_000];
  for (const amount_minor of amounts) {
    const { error } = await owner.client.rpc("create_expense_with_splits", {
      p_payload: {
        household_id: householdId!,
        payer_id: owner.id,
        category_id: categoryId,
        description: `Insights fixture ${amount_minor}`,
        amount_minor,
        split_method: "equal",
        spent_at: spentAt,
        splits: [
          { user_id: owner.id, share_minor: Math.ceil(amount_minor / 2) },
          { user_id: member.id, share_minor: Math.floor(amount_minor / 2) },
        ],
      },
    });
    if (error) throw error;
  }

  f = { householdId: householdId!, owner, member, outsider, categoryId, spentAt };
});

describe("get_monthly_breakdown", () => {
  it("totals agree with the sum of the seeded expenses", async () => {
    const { data, error } = await f.owner.client.rpc("get_monthly_breakdown", {
      p_household_id: f.householdId,
      p_from: "2026-08-01",
      p_to: "2026-08-31",
    });
    expect(error).toBeNull();

    const total = (data ?? []).reduce((sum, row) => sum + row.total_minor, 0);
    expect(total).toBe(12_345 + 6_780 + 30_000);

    const groceries = data?.find((row) => row.category_id === f.categoryId);
    expect(groceries?.expense_count).toBe(3);
  });

  it("is empty for a non-member", async () => {
    const { data } = await f.outsider.client.rpc("get_monthly_breakdown", {
      p_household_id: f.householdId,
      p_from: "2026-08-01",
      p_to: "2026-08-31",
    });
    expect(data).toEqual([]);
  });
});

describe("get_member_stats", () => {
  it("splits paid vs. consumed correctly per member", async () => {
    const { data, error } = await f.owner.client.rpc("get_member_stats", {
      p_household_id: f.householdId,
      p_from: "2026-08-01",
      p_to: "2026-08-31",
    });
    expect(error).toBeNull();

    const ownerStats = data?.find((row) => row.user_id === f.owner.id);
    const memberStats = data?.find((row) => row.user_id === f.member.id);

    // The owner paid every fixture expense in full.
    expect(ownerStats?.paid_minor).toBe(12_345 + 6_780 + 30_000);
    // Both consumed roughly half of each — total consumed across both members
    // must equal the grand total, with no money invented or lost in rounding.
    const totalConsumed =
      (ownerStats?.consumed_minor ?? 0) + (memberStats?.consumed_minor ?? 0);
    expect(totalConsumed).toBe(12_345 + 6_780 + 30_000);
  });

  it("is empty for a non-member", async () => {
    const { data } = await f.outsider.client.rpc("get_member_stats", {
      p_household_id: f.householdId,
      p_from: "2026-08-01",
      p_to: "2026-08-31",
    });
    expect(data).toEqual([]);
  });
});
