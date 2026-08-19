/**
 * Ledger integrity: split-sum invariant, modify permissions, concurrency,
 * soft delete, and the zero-sum balance property.
 * =============================================================================
 * These are the rules that make SplitMate a ledger rather than a shared note.
 * Each one is enforced in Postgres (trigger or RPC), not only in the client —
 * so each test calls the RPC or table directly, the same way a malicious or
 * merely buggy client would, rather than going through `lib/actions`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { admin, cleanupTestUsers, testUser } from "./helpers";

afterAll(cleanupTestUsers);

interface Household {
  id: string;
  owner: Awaited<ReturnType<typeof testUser>>;
  member: Awaited<ReturnType<typeof testUser>>;
  outsider: Awaited<ReturnType<typeof testUser>>;
}

let h: Household;

beforeAll(async () => {
  const [owner, member, outsider] = await Promise.all([
    testUser("owner"),
    testUser("member"),
    testUser("outsider"),
  ]);

  const { data: householdId, error } = await owner.client.rpc("create_household", {
    p_name: "Ledger Household",
  });
  if (error) throw error;

  await admin
    .from("household_members")
    .insert({ household_id: householdId!, user_id: member.id, role: "member" });

  h = { id: householdId!, owner, member, outsider };
});

function expensePayload(overrides: Record<string, unknown> = {}) {
  return {
    household_id: h.id,
    payer_id: h.owner.id,
    category_id: null,
    description: "Test expense",
    amount_minor: 10_000,
    split_method: "equal",
    spent_at: "2026-08-01",
    splits: [
      { user_id: h.owner.id, share_minor: 5_000 },
      { user_id: h.member.id, share_minor: 5_000 },
    ],
    ...overrides,
  };
}

describe("split-sum invariant", () => {
  it("rejects splits that do not sum to the total", async () => {
    const { error } = await h.owner.client.rpc("create_expense_with_splits", {
      p_payload: expensePayload({
        splits: [
          { user_id: h.owner.id, share_minor: 4_000 },
          { user_id: h.member.id, share_minor: 5_000 },
        ],
      }),
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("SPLIT_IMBALANCE");
  });

  it("rejects a split naming someone outside the household", async () => {
    const { error } = await h.owner.client.rpc("create_expense_with_splits", {
      p_payload: expensePayload({
        splits: [
          { user_id: h.owner.id, share_minor: 5_000 },
          { user_id: h.outsider.id, share_minor: 5_000 },
        ],
      }),
    });

    expect(error).not.toBeNull();
  });

  it("accepts splits that sum exactly to the total", async () => {
    const { data: expenseId, error } = await h.owner.client.rpc(
      "create_expense_with_splits",
      { p_payload: expensePayload() },
    );
    expect(error).toBeNull();
    expect(expenseId).toBeTruthy();
  });
});

describe("idempotency", () => {
  it("returns the same expense for a repeated idempotency key", async () => {
    const key = `idem-${Math.random().toString(36).slice(2)}`;
    const payload = expensePayload({ idempotency_key: key });

    const first = await h.owner.client.rpc("create_expense_with_splits", {
      p_payload: payload,
    });
    const second = await h.owner.client.rpc("create_expense_with_splits", {
      p_payload: payload,
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    const { count } = await admin
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("idempotency_key", key);
    expect(count).toBe(1);
  });
});

describe("modify permissions", () => {
  it("refuses an update from a member who is not the payer, creator, or an admin/owner", async () => {
    const bystander = await testUser("bystander");
    await admin
      .from("household_members")
      .insert({ household_id: h.id, user_id: bystander.id, role: "member" });

    const { data: expenseId } = await h.owner.client.rpc("create_expense_with_splits", {
      p_payload: expensePayload({ description: "Only the owner may touch this" }),
    });

    const { data: before } = await admin
      .from("expenses")
      .select("updated_at")
      .eq("id", expenseId!)
      .single();

    const { error } = await bystander.client.rpc("update_expense_with_splits", {
      p_expense_id: expenseId!,
      p_expected_updated_at: before!.updated_at,
      p_payload: expensePayload({ description: "Hijacked" }),
    });

    // RLS makes the underlying UPDATE affect zero rows; the function raises
    // NOT_FOUND rather than silently doing nothing.
    expect(error).not.toBeNull();

    const { data: after } = await admin
      .from("expenses")
      .select("description")
      .eq("id", expenseId!)
      .single();
    expect(after?.description).toBe("Only the owner may touch this");
  });

  it("allows the payer to edit their own expense", async () => {
    const { data: expenseId } = await h.member.client.rpc(
      "create_expense_with_splits",
      {
        p_payload: expensePayload({
          payer_id: h.member.id,
          description: "Member's own",
        }),
      },
    );

    const { data: before } = await admin
      .from("expenses")
      .select("updated_at")
      .eq("id", expenseId!)
      .single();

    const { error } = await h.member.client.rpc("update_expense_with_splits", {
      p_expense_id: expenseId!,
      p_expected_updated_at: before!.updated_at,
      p_payload: expensePayload({
        payer_id: h.member.id,
        description: "Member's own, edited",
      }),
    });

    expect(error).toBeNull();
  });

  it("rejects an update carrying a stale expected timestamp (lost-update guard)", async () => {
    const { data: expenseId } = await h.owner.client.rpc("create_expense_with_splits", {
      p_payload: expensePayload({ description: "Concurrency target" }),
    });

    const { data: before } = await admin
      .from("expenses")
      .select("updated_at")
      .eq("id", expenseId!)
      .single();

    // Someone else's edit lands first.
    await h.owner.client.rpc("update_expense_with_splits", {
      p_expense_id: expenseId!,
      p_expected_updated_at: before!.updated_at,
      p_payload: expensePayload({ description: "First editor wins" }),
    });

    // A second editor, still holding the ORIGINAL timestamp, tries to save.
    const { error } = await h.owner.client.rpc("update_expense_with_splits", {
      p_expense_id: expenseId!,
      p_expected_updated_at: before!.updated_at,
      p_payload: expensePayload({ description: "Second editor, stale" }),
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("CONFLICT");
  });
});

describe("soft delete", () => {
  it("excludes a deleted expense from balances but keeps it in the audit trail", async () => {
    const { data: expenseId } = await h.owner.client.rpc("create_expense_with_splits", {
      p_payload: expensePayload({
        description: "Will be deleted",
        amount_minor: 20_000,
        splits: [
          { user_id: h.owner.id, share_minor: 10_000 },
          { user_id: h.member.id, share_minor: 10_000 },
        ],
      }),
    });

    const before = await h.owner.client.rpc("get_household_balances", {
      p_household_id: h.id,
    });
    const beforeOwnerNet =
      before.data?.find((row) => row.user_id === h.owner.id)?.net ?? 0;

    const { error } = await h.owner.client.rpc("soft_delete_expense", {
      p_expense_id: expenseId!,
    });
    expect(error).toBeNull();

    const after = await h.owner.client.rpc("get_household_balances", {
      p_household_id: h.id,
    });
    const afterOwnerNet =
      after.data?.find((row) => row.user_id === h.owner.id)?.net ?? 0;

    // The owner paid the deleted expense's 20,000 in full and was owed 10,000
    // back; removing it should shift their net down by exactly 10,000.
    expect(beforeOwnerNet - afterOwnerNet).toBe(10_000);

    // Still visible to any member — soft delete is not erasure.
    const { data: stillThere } = await h.member.client
      .from("expenses")
      .select("id, deleted_at")
      .eq("id", expenseId!)
      .single();
    expect(stillThere?.deleted_at).not.toBeNull();
  });
});

describe("settle_up", () => {
  it("rejects settling with yourself", async () => {
    const { error } = await h.owner.client.rpc("settle_up", {
      p_household_id: h.id,
      p_from_user: h.owner.id,
      p_to_user: h.owner.id,
      p_amount_minor: 1_000,
    });
    expect(error).not.toBeNull();
  });

  it("rejects settling with someone outside the household", async () => {
    const { error } = await h.owner.client.rpc("settle_up", {
      p_household_id: h.id,
      p_from_user: h.owner.id,
      p_to_user: h.outsider.id,
      p_amount_minor: 1_000,
    });
    expect(error).not.toBeNull();
  });

  it("rejects a caller recording a payment between two other people", async () => {
    const { error } = await h.member.client.rpc("settle_up", {
      p_household_id: h.id,
      p_from_user: h.owner.id,
      p_to_user: h.outsider.id,
      p_amount_minor: 1_000,
    });
    expect(error).not.toBeNull();
  });

  it("a voided settlement stops affecting the balance", async () => {
    const before = await h.owner.client.rpc("get_household_balances", {
      p_household_id: h.id,
    });
    const beforeNet = before.data?.find((row) => row.user_id === h.member.id)?.net ?? 0;

    const { data: settlementId, error } = await h.member.client.rpc("settle_up", {
      p_household_id: h.id,
      p_from_user: h.member.id,
      p_to_user: h.owner.id,
      p_amount_minor: 3_000,
    });
    expect(error).toBeNull();

    const afterSettle = await h.owner.client.rpc("get_household_balances", {
      p_household_id: h.id,
    });
    const afterSettleNet =
      afterSettle.data?.find((row) => row.user_id === h.member.id)?.net ?? 0;
    expect(afterSettleNet - beforeNet).toBe(3_000);

    const { error: voidError } = await h.member.client.rpc("void_settlement", {
      p_settlement_id: settlementId!,
    });
    expect(voidError).toBeNull();

    const afterVoid = await h.owner.client.rpc("get_household_balances", {
      p_household_id: h.id,
    });
    const afterVoidNet =
      afterVoid.data?.find((row) => row.user_id === h.member.id)?.net ?? 0;
    expect(afterVoidNet).toBe(beforeNet);
  });
});

describe("zero-sum balances", () => {
  it("every member's net always sums to zero across the household", async () => {
    const { data: rows, error } = await h.owner.client.rpc("get_household_balances", {
      p_household_id: h.id,
    });
    expect(error).toBeNull();

    const total = (rows ?? []).reduce((sum, row) => sum + row.net, 0);
    expect(total).toBe(0);
  });
});
