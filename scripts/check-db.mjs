/**
 * Smoke-checks the live database after a migration.
 * =============================================================================
 * Run with `npm run db:check`.
 *
 * `supabase db push` reporting success only tells us the SQL executed. It says
 * nothing about whether PostgREST can see the result, whether RLS is actually
 * switched on, or whether the RPCs the application calls exist with the
 * signatures it expects. Those are the failures that surface as a mystifying
 * 404 or an empty screen much later, so this checks them directly.
 *
 * Every assertion here is read-only.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env.local");

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envPath)) return undefined;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (match?.[1]?.trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !anonKey || !serviceKey) {
  console.error(
    "\n  Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or " +
      "SUPABASE_SERVICE_ROLE_KEY in .env.local.\n",
  );
  process.exit(1);
}

// Printed rather than assumed: environment variables take precedence over
// .env.local, so a stale value left over in a shell can silently point these
// checks at a different project — which reads as "every table is missing".
console.log(`\n  Target: ${url}`);

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, noSession);
const anon = createClient(url, anonKey, noSession);

const TABLES = [
  "profiles",
  "households",
  "household_members",
  "invitations",
  "categories",
  "recurring_expenses",
  "expenses",
  "expense_splits",
  "expense_revisions",
  "settlements",
  "shopping_lists",
  "shopping_items",
  "notifications",
  "activity_log",
];

// RPCs the application calls. Their presence is read from the OpenAPI document
// PostgREST publishes, rather than by invoking them: PostgREST resolves an
// overload from the exact set of named arguments supplied, so a call with
// placeholder arguments reports a missing function whenever the argument list
// is merely incomplete. The document lists what is genuinely exposed.
const FUNCTIONS = [
  "create_household",
  "accept_invitation",
  "create_expense_with_splits",
  "update_expense_with_splits",
  "soft_delete_expense",
  "settle_up",
  "void_settlement",
  "checkout_shopping_items",
  "get_household_balances",
  "get_monthly_breakdown",
  "get_member_stats",
];

const failures = [];
const note = (ok, label, detail) => {
  console.log(
    `  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failures.push(label);
};

console.log("\n  Tables reachable through PostgREST");
for (const table of TABLES) {
  const { error } = await admin.from(table).select("*", { head: true, count: "exact" });
  note(!error, table, error?.message);
}

// A transport failure must never be read as a passing assertion: every check
// below infers success from the *absence* of a particular error, and an
// unreachable server produces no error of that kind either.
const unreachable = (error) =>
  /fetch failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(error?.message ?? "");

console.log("\n  RLS denies an anonymous caller");
for (const table of ["households", "expenses", "settlements", "notifications"]) {
  const { data, error } = await anon.from(table).select("*").limit(1);
  // A permissive table would return rows; a protected one returns an empty set
  // (policies evaluate auth.uid() to null) or an explicit permission error.
  const denied = !unreachable(error) && (error !== null || (data?.length ?? 0) === 0);
  note(denied, table, error?.message);
}

console.log("\n  Business functions exposed");
const spec = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
  },
})
  .then((res) => res.json())
  .catch((error) => ({ error }));

if (!spec?.paths) {
  note(
    false,
    "OpenAPI document",
    spec?.error?.message ?? "PostgREST returned no path list",
  );
} else {
  for (const name of FUNCTIONS) {
    note(Object.hasOwn(spec.paths, `/rpc/${name}`), name, "not exposed");
  }
}

if (failures.length > 0) {
  console.error(`\n  ${failures.length} check(s) failed: ${failures.join(", ")}\n`);
  process.exit(1);
}

console.log("\n  Database looks healthy.\n");
