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
 *   node scripts/dev-user.mjs seed         # rebuild a populated household
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

const [command, ...args] = process.argv.slice(2);

async function login(name, baseUrl = "http://localhost:3000") {
  if (!name) throw new Error("usage: node scripts/dev-user.mjs login <name> [baseUrl]");

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
    `${baseUrl}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`,
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

  // Balances go through an authenticated client because `get_household_balances`
  // is SECURITY INVOKER: with the service-role key there is no `auth.uid()` and
  // RLS does not apply, so the numbers it returned would not be the numbers a
  // real member sees. Reading them the way the app reads them is the point.
  const balances = [];
  for (const household of households ?? []) {
    const owner = users.users.find((user) => user.email?.endsWith(TEST_DOMAIN));
    if (!owner?.email) continue;

    const client = await signIn(owner.email);
    const { data, error } = await client.rpc("get_household_balances", {
      p_household_id: household.id,
    });
    balances.push({ household: household.name, rows: error ? error.message : data });
  }

  console.log(
    JSON.stringify(
      {
        authUsers: users.users.map((user) => user.email),
        profiles,
        households,
        members,
        invitations,
        balances,
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

/**
 * Signs in as a test account and returns a client carrying that user's session.
 *
 * Seeding through an authenticated client rather than the service-role key is a
 * deliberate cost. It would be quicker to insert rows directly, but the RPCs
 * read `auth.uid()` and the split-balance trigger is deferred to end of
 * transaction — so direct inserts would either fail or, worse, bypass the exact
 * invariants the seed exists to demonstrate. Going through the front door means
 * a successful seed is also evidence that the write path works.
 */
async function signIn(email) {
  const client = createClient(
    readEnv("NEXT_PUBLIC_SUPABASE_URL"),
    readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw linkError;

  const { error } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (error) throw error;

  return client;
}

async function ensureUser(name) {
  const email = `${name}${TEST_DOMAIN}`;
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list.users.find((candidate) => candidate.email === email);
  if (existing) return existing;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: name.charAt(0).toUpperCase() + name.slice(1) },
  });
  if (error) throw error;
  return data.user;
}

/**
 * Splits a total evenly, giving the indivisible remainder to the earliest
 * participants one minor unit at a time. Mirrors `lib/domain/splits.ts` closely
 * enough for fixtures; the real allocator is the one under test, not this.
 */
function evenSplit(totalMinor, userIds) {
  const base = Math.floor(totalMinor / userIds.length);
  let remainder = totalMinor - base * userIds.length;

  return userIds.map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { user_id: userId, share_minor: base + extra };
  });
}

async function seed() {
  await cleanup();

  const [maya, yonatan, noa] = await Promise.all([
    ensureUser("maya"),
    ensureUser("yonatan"),
    ensureUser("noa"),
  ]);
  const everyone = [maya.id, yonatan.id, noa.id];

  const asMaya = await signIn(maya.email);
  const { data: householdId, error: householdError } = await asMaya.rpc(
    "create_household",
    { p_name: "Dizengoff 42" },
  );
  if (householdError) throw householdError;

  const { error: memberError } = await admin.from("household_members").insert([
    { household_id: householdId, user_id: yonatan.id, role: "admin" },
    { household_id: householdId, user_id: noa.id, role: "member" },
  ]);
  if (memberError) throw memberError;

  const { data: categories } = await admin
    .from("categories")
    .select("id, name")
    .eq("household_id", householdId);
  const categoryId = (name) => categories?.find((c) => c.name === name)?.id ?? null;

  const today = new Date();
  const daysAgo = (n) =>
    new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);

  // Amounts are chosen to exercise the interesting cases, not to look tidy:
  // 287.45 across three people does not divide, and the electricity bill is
  // split by percentage rather than evenly.
  const expenses = [
    {
      as: maya,
      description: "Rent — August",
      amount_minor: 540_000,
      category: "Rent",
      split_method: "equal",
      spent_at: daysAgo(12),
      splits: evenSplit(540_000, everyone),
    },
    {
      as: yonatan,
      description: "Weekly groceries",
      amount_minor: 28_745,
      category: "Groceries",
      split_method: "equal",
      spent_at: daysAgo(5),
      splits: evenSplit(28_745, everyone),
    },
    {
      as: noa,
      description: "Internet",
      amount_minor: 12_990,
      category: "Utilities",
      split_method: "equal",
      spent_at: daysAgo(3),
      splits: evenSplit(12_990, everyone),
    },
    {
      as: maya,
      description: "Electricity",
      amount_minor: 41_200,
      category: "Utilities",
      split_method: "percentage",
      spent_at: daysAgo(1),
      splits: [
        { user_id: maya.id, share_minor: 20_600, share_input: 50 },
        { user_id: yonatan.id, share_minor: 12_360, share_input: 30 },
        { user_id: noa.id, share_minor: 8_240, share_input: 20 },
      ],
    },
  ];

  const sessions = new Map([[maya.id, asMaya]]);
  for (const expense of expenses) {
    if (!sessions.has(expense.as.id)) {
      sessions.set(expense.as.id, await signIn(expense.as.email));
    }

    const { error } = await sessions
      .get(expense.as.id)
      .rpc("create_expense_with_splits", {
        p_payload: {
          household_id: householdId,
          payer_id: expense.as.id,
          category_id: categoryId(expense.category),
          description: expense.description,
          amount_minor: expense.amount_minor,
          split_method: expense.split_method,
          spent_at: expense.spent_at,
          splits: expense.splits,
        },
      });
    if (error) throw new Error(`${expense.description}: ${error.message}`);
    console.log(`expense ${expense.description}: created`);
  }

  // One partial repayment, so balances are not a clean multiple of anything and
  // the settlement path has something to render.
  const asNoa = sessions.get(noa.id) ?? (await signIn(noa.email));
  const { error: settlementError } = await asNoa.rpc("settle_up", {
    p_household_id: householdId,
    p_from_user: noa.id,
    p_to_user: maya.id,
    p_amount_minor: 20_000,
    p_method: "bank_transfer",
    p_note: "Partial — rest next week",
  });
  if (settlementError) throw settlementError;
  console.log("settlement Noa → Maya 200.00: created");

  console.log(`\nhousehold ready: http://localhost:3000/app/households/${householdId}`);
  console.log("sign in with: node scripts/dev-user.mjs login maya");
}

const commands = { login, seed, state, cleanup };
const handler = commands[command];

if (!handler) {
  console.error(
    `unknown command "${command ?? ""}" — expected login, seed, state or cleanup`,
  );
  process.exit(1);
}

try {
  await handler(...args);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
