/**
 * Local development helper for signing in as throwaway accounts.
 * =============================================================================
 * Testing anything in SplitMate needs two or three signed-in people, and the
 * real sign-in path goes through an inbox. This mints the link that email would
 * have contained, using the Admin API, so a multi-user flow can be exercised in
 * a browser without a mail server.
 *
 * It is a development tool and nothing else: it requires the service-role key,
 * it is never imported by the application, and every account it creates uses the
 * reserved `@splitmate.test` domain so `cleanup` can identify them
 * unambiguously.
 *
 *   node scripts/dev-user.mjs login maya   # print a one-time sign-in URL
 *   node scripts/dev-user.mjs state        # dump users, households, invitations
 *   node scripts/dev-user.mjs cleanup      # remove every @splitmate.test account
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const TEST_DOMAIN = "@splitmate.test";

/**
 * Reads a single key out of `.env.local`.
 *
 * Deliberately not `dotenv`: this script must never quietly pick up a
 * production service-role key from an ambient environment variable, so it looks
 * in exactly one file and fails loudly if the value is not there.
 */
function readEnv(key) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  throw new Error(`${key} is missing from .env.local`);
}

const admin = createClient(
  readEnv("NEXT_PUBLIC_SUPABASE_URL"),
  readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const [command, argument] = process.argv.slice(2);

async function login(name) {
  if (!name) throw new Error("usage: node scripts/dev-user.mjs login <name>");

  const email = `${name}${TEST_DOMAIN}`;
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list.users.find((candidate) => candidate.email === email);

  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      // Read by the handle_new_user trigger, so the member list shows a real
      // name instead of three variations of "user".
      user_metadata: { full_name: name.charAt(0).toUpperCase() + name.slice(1) },
    });
    if (error) throw error;
    user = data.user;
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;

  console.log(
    `http://localhost:3000/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`,
  );
}

async function state() {
  const { data: users } = await admin.auth.admin.listUsers();
  const { data: profiles } = await admin.from("profiles").select("id, email");
  const { data: households } = await admin
    .from("households")
    .select("id, name, currency");
  const { data: members } = await admin
    .from("household_members")
    .select("household_id, role, profiles(email)");
  const { data: invitations } = await admin
    .from("invitations")
    .select("id, email, role, accepted_at, revoked_at, expires_at");

  console.log(
    JSON.stringify(
      {
        authUsers: users.users.map((user) => user.email),
        profiles,
        households,
        members,
        invitations,
      },
      null,
      2,
    ),
  );
}

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers();
  const testUsers = data.users.filter((user) => user.email?.endsWith(TEST_DOMAIN));
  const ids = testUsers.map((user) => user.id);

  if (ids.length === 0) {
    console.log("nothing to clean up");
    return;
  }

  // Households have to go first. Deleting an auth user cascades into `profiles`,
  // but `households.created_by` references `profiles` with no ON DELETE action —
  // so Postgres refuses to remove someone whose created rows still exist. That
  // is the correct rule for a ledger (an expense must always name who recorded
  // it), and it means real account deletion will have to tombstone the profile
  // rather than delete it.
  const { data: owned } = await admin
    .from("households")
    .select("id, name")
    .in("created_by", ids);

  for (const household of owned ?? []) {
    const { error } = await admin.from("households").delete().eq("id", household.id);
    console.log(
      `household ${household.name}: ${error ? `FAILED — ${error.message}` : "deleted"}`,
    );
  }

  for (const user of testUsers) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    console.log(
      `user ${user.email}: ${error ? `FAILED — ${error.message}` : "deleted"}`,
    );
  }
}

const commands = { login, state, cleanup };
const handler = commands[command];

if (!handler) {
  console.error(
    `unknown command "${command ?? ""}" — expected login, state or cleanup`,
  );
  process.exit(1);
}

try {
  await handler(argument);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
