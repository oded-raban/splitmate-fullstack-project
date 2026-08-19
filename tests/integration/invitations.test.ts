/**
 * Invitation lifecycle: preview and acceptance without leaking anything to a
 * caller who does not yet hold a valid token.
 * =============================================================================
 * `preview_invitation` and `accept_invitation` are the two SECURITY DEFINER
 * functions that let a non-member interact with a household they cannot read
 * directly. Both are attacked here from a client that genuinely has no other
 * access to the target household.
 */

import { createHash, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { admin, cleanupTestUsers, testUser } from "./helpers";

afterAll(cleanupTestUsers);

interface Fixture {
  householdId: string;
  owner: Awaited<ReturnType<typeof testUser>>;
}

let f: Fixture;

beforeAll(async () => {
  const owner = await testUser("owner");
  const { data: householdId } = await owner.client.rpc("create_household", {
    p_name: "Invited Household",
  });
  f = { householdId: householdId!, owner };
});

/** Inserts an invitation row directly (bypassing the createInvitation action's
 * validation, which is not what this file tests) and returns the raw token. */
async function makeInvitation(overrides: Record<string, unknown> = {}) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data, error } = await f.owner.client
    .from("invitations")
    .insert({
      household_id: f.householdId,
      token_hash: tokenHash,
      role: "member",
      created_by: f.owner.id,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;

  return { id: data.id, token };
}

describe("preview_invitation", () => {
  it("does not leak the invited email address to the wrong signed-in user", async () => {
    const wrongUser = await testUser("wrong-recipient");
    const { token } = await makeInvitation({ email: "someone-specific@example.com" });

    const { data, error } = await wrongUser.client.rpc("preview_invitation", {
      p_token: token,
    });
    expect(error).toBeNull();

    const preview = data?.[0];
    expect(preview?.status).toBe("email_mismatch");
    // The whole point: the mismatch is reported without echoing the address.
    expect(preview?.invited_email).toBeNull();
  });

  it("shows the invited email to the actual invitee it matches", async () => {
    const invitee = await testUser("matching-invitee");
    const { token } = await makeInvitation({ email: invitee.email });

    const { data } = await invitee.client.rpc("preview_invitation", { p_token: token });
    expect(data?.[0]?.status).toBe("valid");
    expect(data?.[0]?.invited_email).toBe(invitee.email);
  });

  it("shows the invited email to a household admin previewing their own invitation", async () => {
    const { token } = await makeInvitation({ email: "admin-visible@example.com" });

    const { data } = await f.owner.client.rpc("preview_invitation", { p_token: token });
    // The owner is not the invitee, but is entitled to see it via `invitations_select`.
    expect(data?.[0]?.invited_email).toBe("admin-visible@example.com");
  });

  it("reports 'invalid' for an unknown token without revealing anything", async () => {
    const stranger = await testUser("stranger");
    const { data, error } = await stranger.client.rpc("preview_invitation", {
      p_token: "not-a-real-token",
    });
    expect(error).toBeNull();
    expect(data?.[0]?.status).toBe("invalid");
    expect(data?.[0]?.household_id).toBeNull();
  });

  it("reports 'expired' for a lapsed invitation", async () => {
    const invitee = await testUser("expired-invitee");
    const { token } = await makeInvitation({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const { data } = await invitee.client.rpc("preview_invitation", { p_token: token });
    expect(data?.[0]?.status).toBe("expired");
  });

  it("reports 'revoked' for a cancelled invitation", async () => {
    const invitee = await testUser("revoked-invitee");
    const { id, token } = await makeInvitation();
    await admin
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);

    const { data } = await invitee.client.rpc("preview_invitation", { p_token: token });
    expect(data?.[0]?.status).toBe("revoked");
  });
});

describe("accept_invitation", () => {
  it("joins the household on a valid, unbound link invitation", async () => {
    const invitee = await testUser("link-invitee");
    const { token } = await makeInvitation();

    const { data: householdId, error } = await invitee.client.rpc("accept_invitation", {
      p_token: token,
    });
    expect(error).toBeNull();
    expect(householdId).toBe(f.householdId);

    const { data: membership } = await admin
      .from("household_members")
      .select("role")
      .eq("household_id", f.householdId)
      .eq("user_id", invitee.id)
      .single();
    expect(membership?.role).toBe("member");
  });

  it("refuses an expired token", async () => {
    const invitee = await testUser("expired-acceptor");
    const { token } = await makeInvitation({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const { error } = await invitee.client.rpc("accept_invitation", { p_token: token });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("INVITE_EXPIRED");
  });

  it("refuses an already-accepted token", async () => {
    const first = await testUser("first-acceptor");
    const second = await testUser("second-acceptor");
    const { token } = await makeInvitation();

    const { error: firstError } = await first.client.rpc("accept_invitation", {
      p_token: token,
    });
    expect(firstError).toBeNull();

    const { error: secondError } = await second.client.rpc("accept_invitation", {
      p_token: token,
    });
    expect(secondError).not.toBeNull();
    expect(secondError?.message).toContain("INVITE_USED");
  });

  it("refuses a revoked token", async () => {
    const invitee = await testUser("revoked-acceptor");
    const { id, token } = await makeInvitation();
    await admin
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);

    const { error } = await invitee.client.rpc("accept_invitation", { p_token: token });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("INVITE_REVOKED");
  });

  it("refuses an email-targeted invitation opened by the wrong address", async () => {
    const wrongUser = await testUser("wrong-acceptor");
    const { token } = await makeInvitation({ email: "someone-else@example.com" });

    const { error } = await wrongUser.client.rpc("accept_invitation", {
      p_token: token,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("INVITE_EMAIL_MISMATCH");
  });
});

describe("invitations table access", () => {
  it("is invisible to a non-member, even by direct select", async () => {
    const stranger = await testUser("list-stranger");
    const { data } = await stranger.client
      .from("invitations")
      .select("id")
      .eq("household_id", f.householdId);
    expect(data).toEqual([]);
  });

  it("is invisible to a plain member (only owners/admins may list invitations)", async () => {
    const member = await testUser("plain-member");
    await admin
      .from("household_members")
      .insert({ household_id: f.householdId, user_id: member.id, role: "member" });

    const { data } = await member.client
      .from("invitations")
      .select("id")
      .eq("household_id", f.householdId);
    expect(data).toEqual([]);
  });
});
