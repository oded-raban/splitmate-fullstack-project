/**
 * Storage RLS: the receipts bucket's path-derived authorization model.
 * =============================================================================
 * `storage_household_id()` parses the first path segment of an object name and
 * checks membership of that household — so the policy is attacked here the
 * same way it would be in reality: by trying to read, write and list under a
 * path naming a household the caller does not belong to.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { admin, cleanupTestUsers, testUser } from "./helpers";

afterAll(cleanupTestUsers);

interface Fixture {
  householdId: string;
  member: Awaited<ReturnType<typeof testUser>>;
  outsider: Awaited<ReturnType<typeof testUser>>;
}

let f: Fixture;

// A 1x1 transparent WebP, small enough to upload without any image tooling.
const TINY_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
  0x38, 0x4c, 0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11,
  0x11, 0x88, 0x88, 0xfe, 0x07,
]);

beforeAll(async () => {
  const [member, outsider] = await Promise.all([
    testUser("member"),
    testUser("outsider"),
  ]);
  const { data: householdId } = await member.client.rpc("create_household", {
    p_name: "Receipted Household",
  });
  f = { householdId: householdId!, member, outsider };
});

describe("bucket configuration", () => {
  it("is not a public bucket", async () => {
    const { data, error } = await admin.storage.getBucket("receipts");
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
  });
});

describe("path-derived authorization", () => {
  it("lets a household member upload and read under their own household's path", async () => {
    const path = `${f.householdId}/00000000-0000-0000-0000-000000000001/test.webp`;

    const { error: uploadError } = await f.member.client.storage
      .from("receipts")
      .upload(path, TINY_WEBP, { contentType: "image/webp" });
    expect(uploadError).toBeNull();

    const { data: signedUrl, error: signError } = await f.member.client.storage
      .from("receipts")
      .createSignedUrl(path, 60);
    expect(signError).toBeNull();
    expect(signedUrl?.signedUrl).toBeTruthy();

    await admin.storage.from("receipts").remove([path]);
  });

  it("refuses an outsider uploading into a household they do not belong to", async () => {
    const path = `${f.householdId}/00000000-0000-0000-0000-000000000002/sneaky.webp`;

    const { error } = await f.outsider.client.storage
      .from("receipts")
      .upload(path, TINY_WEBP, { contentType: "image/webp" });

    expect(error).not.toBeNull();
  });

  it("refuses an outsider reading a receipt at a known path", async () => {
    const path = `${f.householdId}/00000000-0000-0000-0000-000000000003/private.webp`;
    await admin.storage
      .from("receipts")
      .upload(path, TINY_WEBP, { contentType: "image/webp" });

    // A signed URL cannot be minted for an object the caller cannot read —
    // this is the exact mechanism the app's `getReceiptUrl` action relies on.
    const { data, error } = await f.outsider.client.storage
      .from("receipts")
      .createSignedUrl(path, 60);
    expect(data?.signedUrl).toBeFalsy();
    expect(error).not.toBeNull();

    await admin.storage.from("receipts").remove([path]);
  });

  it("refuses an outsider listing objects under a household path they guess", async () => {
    const { data, error } = await f.outsider.client.storage
      .from("receipts")
      .list(f.householdId);

    // Storage's `list` does not error for a denied prefix; RLS simply makes it
    // return nothing, which is the behaviour that matters here.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
