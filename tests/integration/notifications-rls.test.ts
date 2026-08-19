/**
 * RLS: notifications are strictly personal, and cannot be forged by a client.
 * =============================================================================
 * The `notifications` table has no INSERT policy at all (see the RLS
 * migration's comment on that table) — every row is written by the
 * `notify_users` SECURITY DEFINER helper, triggered by an actual ledger event.
 * A direct client insert must therefore fail unconditionally, for every
 * authenticated caller, regardless of household membership.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { admin, cleanupTestUsers, testUser } from "./helpers";

afterAll(cleanupTestUsers);

interface Fixture {
  householdId: string;
  owner: Awaited<ReturnType<typeof testUser>>;
  member: Awaited<ReturnType<typeof testUser>>;
}

let f: Fixture;

beforeAll(async () => {
  const [owner, member] = await Promise.all([testUser("owner"), testUser("member")]);
  const { data: householdId } = await owner.client.rpc("create_household", {
    p_name: "Notified Household",
  });
  await admin
    .from("household_members")
    .insert({ household_id: householdId!, user_id: member.id, role: "member" });
  f = { householdId: householdId!, owner, member };
});

describe("no client-side INSERT", () => {
  it("rejects a household member inserting a notification directly", async () => {
    const { error } = await f.member.client.from("notifications").insert({
      user_id: f.member.id,
      household_id: f.householdId,
      type: "settlement_recorded",
      payload: { amount_minor: 999_999 },
    });
    expect(error).not.toBeNull();
  });

  it("rejects a member spoofing a notification addressed to someone else", async () => {
    const { error } = await f.member.client.from("notifications").insert({
      user_id: f.owner.id,
      household_id: f.householdId,
      type: "settlement_recorded",
      payload: { amount_minor: 999_999, message: "spoofed" },
    });
    expect(error).not.toBeNull();
  });
});

describe("read isolation", () => {
  it("a member cannot read another member's notifications, even within the same household", async () => {
    // Seed a real notification via the sanctioned path (an actual expense).
    const { error: expenseError } = await f.owner.client.rpc(
      "create_expense_with_splits",
      {
        p_payload: {
          household_id: f.householdId,
          payer_id: f.owner.id,
          category_id: null,
          description: "Triggers a notification",
          amount_minor: 2_000,
          split_method: "equal",
          spent_at: "2026-08-01",
          splits: [
            { user_id: f.owner.id, share_minor: 1_000 },
            { user_id: f.member.id, share_minor: 1_000 },
          ],
        },
      },
    );
    expect(expenseError).toBeNull();

    const { data: ownNotifications } = await f.member.client
      .from("notifications")
      .select("id")
      .eq("household_id", f.householdId);
    expect(ownNotifications?.length ?? 0).toBeGreaterThan(0);

    // The owner has their own notification row for the same event (or none,
    // since they are the actor) — but critically, cannot see the MEMBER's row.
    const memberNotificationIds = new Set(ownNotifications?.map((n) => n.id));
    const { data: ownerView } = await f.owner.client
      .from("notifications")
      .select("id")
      .eq("household_id", f.householdId);

    for (const row of ownerView ?? []) {
      expect(memberNotificationIds.has(row.id)).toBe(false);
    }
  });

  it("notify_users only creates rows for actual household members", async () => {
    const outsider = await testUser("outsider");

    // notify_users is SECURITY DEFINER and has no membership check of its own
    // by design (callers are trusted internal code) — but every one of its
    // callers passes participant lists derived from expense_splits, which IS
    // membership-checked. This test documents and locks that composition by
    // confirming the outsider never receives a notification for this
    // household no matter what happens inside it.
    await f.owner.client.rpc("create_expense_with_splits", {
      p_payload: {
        household_id: f.householdId,
        payer_id: f.owner.id,
        category_id: null,
        description: "Outsider must not be notified",
        amount_minor: 1_000,
        split_method: "equal",
        spent_at: "2026-08-01",
        splits: [{ user_id: f.owner.id, share_minor: 1_000 }],
      },
    });

    const { data: outsiderNotifications } = await outsider.client
      .from("notifications")
      .select("id")
      .eq("household_id", f.householdId);
    expect(outsiderNotifications).toEqual([]);
  });
});
