/**
 * Shared setup for the Playwright suite: minting real sign-ins without an
 * inbox, and seeding a household directly through the database when a test's
 * subject is not the creation flow itself.
 * =============================================================================
 * `mintSignInUrl` is the browser-test equivalent of `scripts/dev-user.mjs
 * login`: it uses the Admin API to generate the exact link an email would have
 * contained, then the test navigates to it like a real user clicking through
 * from their inbox. Every account created here uses the reserved
 * `@splitmate.test` domain (see docs/README.md's Phase 3 walkthrough) and is
 * removed by `cleanupTestUsers` in each spec's `afterAll`.
 *
 * Relative imports only, deliberately — Playwright's config does not load
 * `tsconfig.json`'s path aliases, so `@/...` would resolve at type-check time
 * but fail at run time.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TEST_DOMAIN = "@splitmate.test";

function readEnv(key: string): string {
  try {
    const contents = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m").exec(contents);
    if (match?.[1]?.trim()) return match[1].trim();
  } catch {
    // fall through to process.env, which is how CI supplies these secrets
  }

  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;

  throw new Error(`${key} is required to run the E2E suite`);
}

const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");

export const BASE_URL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000";

/** Bypasses RLS. Used only to seed and tear down fixtures, never to assert app behaviour. */
export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RUN_ID = Math.random().toString(36).slice(2, 8);
let counter = 0;

export interface E2eUser {
  id: string;
  email: string;
}

/**
 * Mints a fresh, same-origin magic-link path for an existing account. Mirrors
 * `app/auth/callback/route.ts`'s `token_hash` + `type` contract exactly, so
 * this exercises the same code path a real email link would.
 *
 * Deliberately a function rather than a field cached on `E2eUser`: Supabase's
 * `verifyOtp` consumes the token on first use, so a path minted once and
 * reused for a second `page.goto()` — a real risk once a spec has more than
 * one test per user — lands on `/login?error=expired` instead of signing in.
 * Every navigation gets its own one-time link instead.
 */
export async function signInPath(email: string): Promise<string> {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw linkError;

  return `/auth/callback?token_hash=${link.properties.hashed_token}&type=magiclink`;
}

/** Creates a disposable `@splitmate.test` account for the E2E suite. */
export async function createE2eUser(name: string): Promise<E2eUser> {
  const email = `e2e-${name}-${RUN_ID}-${counter++}${TEST_DOMAIN}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (createError) throw createError;

  return { id: created.user.id, email };
}

/** A signed-in Supabase client for a user created by `createE2eUser`, for fast
 * fixture seeding (e.g. creating a household via the real RPC without driving
 * the onboarding UI) rather than for assertions. */
export async function signedInClient(user: E2eUser): Promise<SupabaseClient> {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (linkError) throw linkError;

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (error) throw error;

  return client;
}

/** Navigates a fresh Playwright page through a one-time magic link for `user`. */
export async function signIn(page: { goto: (url: string) => Promise<unknown> }, user: E2eUser) {
  await page.goto(await signInPath(user.email));
}

/** Removes every `@splitmate.test` account (and households they own) created
 * under this run's id. */
export async function cleanupE2eUsers(): Promise<void> {
  const { data } = await admin.auth.admin.listUsers();
  const testUsers = data.users.filter((user) => user.email?.includes(`-${RUN_ID}-`));
  const ids = testUsers.map((user) => user.id);
  if (ids.length === 0) return;

  const { data: owned } = await admin.from("households").select("id").in("created_by", ids);
  for (const household of owned ?? []) {
    await admin.from("households").delete().eq("id", household.id);
  }
  for (const user of testUsers) {
    await admin.auth.admin.deleteUser(user.id);
  }
}
