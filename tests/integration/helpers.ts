/**
 * Shared fixtures for the RLS/RPC integration suite.
 * =============================================================================
 * These tests run against the same hosted Supabase project as production —
 * there is no local Postgres in this project (see "Environment Status" in
 * docs/README.md). Every account and household this file creates uses the
 * `@splitmate.test` domain that `scripts/dev-user.mjs` already established as
 * the reserved namespace for disposable test data, and every test file that
 * imports this module is responsible for calling `cleanupTestUsers` in an
 * `afterAll` so a passing run leaves nothing behind.
 *
 * WHY THIS SIGNS IN AS A REAL USER INSTEAD OF USING THE SERVICE-ROLE KEY
 * The service-role key bypasses Row-Level Security entirely. A test written
 * against it would prove nothing about the authorization boundary — it is
 * precisely the boundary these tests exist to attack. `signIn` mints a real
 * session via the Admin API's magic-link generator (the same technique
 * `scripts/dev-user.mjs login` uses for manual testing) and hands back a
 * client that carries that session, so every query in a test goes through
 * exactly the RLS policies a real request would.
 */

import { readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

const TEST_DOMAIN = "@splitmate.test";

function readEnv(key: string): string {
  // `.env.local` is read directly rather than relying on ambient environment
  // variables, for the same reason `scripts/dev-user.mjs` does: a stray
  // service-role key in the shell environment must never be picked up
  // silently, since this is the one file in the test suite with the power to
  // create and delete real auth users.
  try {
    const contents = readFileSync(".env.local", "utf8");
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m").exec(contents);
    if (match?.[1]?.trim()) return match[1].trim();
  } catch {
    // fall through to process.env, which is how CI supplies these secrets
  }

  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;

  throw new Error(
    `${key} is required to run the integration suite (checked .env.local and process.env)`,
  );
}

export const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");

/** Bypasses RLS. Used only for fixture setup/teardown, never for assertions. */
export const admin: SupabaseClient<Database> = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

/** A client with no session at all — the "unauthenticated caller" test case. */
export function anonClient(): SupabaseClient<Database> {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let counter = 0;

// Distinguishes one test run's fixtures from another's, so a suite that
// crashes mid-run (leaving accounts behind) does not collide with the next.
const RUN_ID = Math.random().toString(36).slice(2, 8);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an Admin-API call a few times with backoff when Supabase's auth
 * rate limiter kicks in.
 *
 * This suite creates and signs in dozens of throwaway accounts across several
 * files, and `vitest.config.mts` deliberately runs the `integration` project
 * with `fileParallelism: false` to keep fixtures from colliding — but GoTrue's
 * own request-rate limit is tighter than that alone accounts for on a free-tier
 * project. A transient 429 here is an infrastructure ceiling, not a test
 * failure, so it is retried rather than reported as one.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [1000, 3000, 8000, 15000, 25000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit = error instanceof Error && /rate limit/i.test(error.message);
      if (!isRateLimit || attempt >= delays.length) throw error;
      await sleep(delays[attempt]!);
    }
  }
}

/**
 * Creates (or reuses) a throwaway `@splitmate.test` account and returns a
 * client authenticated as that user, plus their id.
 *
 * The name is suffixed with a per-process counter and a run id so parallel
 * `describe` blocks in the same file never collide on the same email, which
 * would otherwise make one test's cleanup delete another's fixture mid-run.
 */
export async function testUser(
  name: string,
): Promise<{ id: string; email: string; client: SupabaseClient<Database> }> {
  const email = `${name}-${RUN_ID}-${counter++}${TEST_DOMAIN}`;

  const created = await withRateLimitRetry(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error) throw error;
    return data;
  });

  const link = await withRateLimitRetry(async () => {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error) throw error;
    return data;
  });

  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await withRateLimitRetry(async () => {
    const { error } = await client.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "magiclink",
    });
    if (error) throw error;
  });

  return { id: created.user.id, email, client };
}

/**
 * Deletes every `@splitmate.test` account created under this run's id, and
 * any household they own. Mirrors `scripts/dev-user.mjs cleanup`'s ordering:
 * households first, because `households.created_by` references `profiles`
 * with no `ON DELETE` action and Postgres refuses to remove a user whose
 * created rows still exist.
 */
export async function cleanupTestUsers(): Promise<void> {
  const { data } = await admin.auth.admin.listUsers();
  const testUsers = data.users.filter((user) => user.email?.includes(`-${RUN_ID}-`));
  const ids = testUsers.map((user) => user.id);
  if (ids.length === 0) return;

  const { data: owned } = await admin
    .from("households")
    .select("id")
    .in("created_by", ids);
  for (const household of owned ?? []) {
    await admin.from("households").delete().eq("id", household.id);
  }

  for (const user of testUsers) {
    await admin.auth.admin.deleteUser(user.id);
  }
}
