/**
 * RLS: cross-household isolation and bootstrap RPCs.
 * =============================================================================
 * These tests attack the same boundary the manual Phase 3 walkthrough checked
 * by hand (docs/README.md): can a signed-in stranger read or touch a household
 * they are not a member of? Every assertion here uses a real authenticated
 * session, never the service-role key — see tests/integration/helpers.ts for
 * why that distinction is the whole point.
 */

import { afterAll, describe, expect, it } from "vitest";

import { admin, anonClient, cleanupTestUsers, testUser } from "./helpers";

afterAll(cleanupTestUsers);

describe("create_household", () => {
  it("atomically bootstraps owner membership, categories and a shopping list", async () => {
    const owner = await testUser("owner");

    const { data: householdId, error } = await owner.client.rpc("create_household", {
      p_name: "Test Household",
    });
    expect(error).toBeNull();
    expect(householdId).toBeTruthy();

    const { data: membership } = await owner.client
      .from("household_members")
      .select("role")
      .eq("household_id", householdId!)
      .eq("user_id", owner.id)
      .single();
    expect(membership?.role).toBe("owner");

    const { data: categories } = await owner.client
      .from("categories")
      .select("id")
      .eq("household_id", householdId!);
    expect(categories?.length).toBeGreaterThanOrEqual(8);

    const { data: lists } = await owner.client
      .from("shopping_lists")
      .select("id")
      .eq("household_id", householdId!);
    expect(lists?.length).toBe(1);
  });

  it("refuses an unauthenticated caller", async () => {
    const { error } = await anonClient().rpc("create_household", { p_name: "Nope" });
    expect(error).not.toBeNull();
  });
});

describe("cross-household isolation", () => {
  it("hides another household's row and every dependent table from a non-member", async () => {
    const [owner, outsider] = await Promise.all([
      testUser("owner"),
      testUser("outsider"),
    ]);

    const { data: householdId } = await owner.client.rpc("create_household", {
      p_name: "Private Household",
    });
    expect(householdId).toBeTruthy();

    // The outsider is a real, signed-in user — just not a member of this
    // household. Every one of these must come back empty, never an error that
    // would leak "this id exists but you can't see it".
    const { data: household } = await outsider.client
      .from("households")
      .select("id")
      .eq("id", householdId!)
      .maybeSingle();
    expect(household).toBeNull();

    const { data: members } = await outsider.client
      .from("household_members")
      .select("user_id")
      .eq("household_id", householdId!);
    expect(members).toEqual([]);

    const { data: categories } = await outsider.client
      .from("categories")
      .select("id")
      .eq("household_id", householdId!);
    expect(categories).toEqual([]);

    const { data: lists } = await outsider.client
      .from("shopping_lists")
      .select("id")
      .eq("household_id", householdId!);
    expect(lists).toEqual([]);

    // The RPC-level view of the household is exactly as blind: SECURITY
    // INVOKER means RLS still applies inside the function.
    const { data: balances } = await outsider.client.rpc("get_household_balances", {
      p_household_id: householdId!,
    });
    expect(balances).toEqual([]);
  });

  it("refuses a non-admin/owner attempt to write a category into someone else's household", async () => {
    const [owner, outsider] = await Promise.all([
      testUser("owner"),
      testUser("outsider"),
    ]);
    const { data: householdId } = await owner.client.rpc("create_household", {
      p_name: "Guarded Household",
    });

    const { error } = await outsider.client
      .from("categories")
      .insert({ household_id: householdId!, name: "Sneaky" });

    expect(error).not.toBeNull();
  });

  it("lets a member see the household but not manage members without owner/admin role", async () => {
    const owner = await testUser("owner");
    const member = await testUser("member");

    const { data: householdId } = await owner.client.rpc("create_household", {
      p_name: "Roled Household",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId!, user_id: member.id, role: "member" });

    // A plain member CAN read the household and its member list...
    const { data: household } = await member.client
      .from("households")
      .select("id")
      .eq("id", householdId!)
      .maybeSingle();
    expect(household?.id).toBe(householdId);

    // ...but cannot promote themselves, or anyone else.
    const { error: promoteError } = await member.client
      .from("household_members")
      .update({ role: "owner" })
      .eq("household_id", householdId!)
      .eq("user_id", member.id);
    // RLS silently affects zero rows rather than raising; assert no rows moved.
    const { data: afterAttempt } = await owner.client
      .from("household_members")
      .select("role")
      .eq("household_id", householdId!)
      .eq("user_id", member.id)
      .single();
    expect(promoteError).toBeNull();
    expect(afterAttempt?.role).toBe("member");

    // Nor can they remove the owner.
    const { error: removeError } = await member.client
      .from("household_members")
      .delete()
      .eq("household_id", householdId!)
      .eq("user_id", owner.id);
    expect(removeError).toBeNull();
    const { data: ownerStillThere } = await owner.client
      .from("household_members")
      .select("user_id")
      .eq("household_id", householdId!)
      .eq("user_id", owner.id)
      .maybeSingle();
    expect(ownerStillThere).not.toBeNull();
  });
});
