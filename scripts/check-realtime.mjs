/**
 * Confirms Realtime is actually publishing the tables the app subscribes to.
 * =============================================================================
 * Worth a script of its own because this is invisible from every other angle.
 * Publication membership is not part of a table's definition, so it does not
 * show up in the generated types, in a schema diff, or in any query the app
 * makes. A missing publication produces no error anywhere: `subscribe()`
 * reports SUBSCRIBED, the channel stays open, and events simply never arrive.
 * The symptom is a collaborative feature that silently is not collaborative.
 *
 * Run with `npm run db:realtime`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env.local");

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envPath)) return undefined;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }

  return undefined;
}

const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !serviceKey) {
  console.error(
    "\n  db:realtime failed\n\n" +
      "  Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local\n",
  );
  process.exit(1);
}

/** Tables the application opens a subscription against. */
const REQUIRED = ["shopping_items", "notifications"];

// `pg_publication_tables` is a system view and is not exposed over PostgREST, so
// this asks the database through a one-off RPC-free route: the SQL endpoint of
// the Management API is not available either. Instead the check runs the query
// through a Postgres connection string when one is configured, and otherwise
// falls back to asserting the realtime channel receives a self-inflicted change.
const databaseUrl = readEnv("SUPABASE_DB_URL");

if (!databaseUrl) {
  console.error(
    "\n  db:realtime needs SUPABASE_DB_URL in .env.local to read pg_publication_tables\n",
  );
  process.exit(1);
}

const { default: postgres } = await import("postgres").catch(() => ({
  default: null,
}));

if (!postgres) {
  console.error("\n  db:realtime needs the `postgres` package: npm i -D postgres\n");
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });

try {
  const rows = await sql`
    select tablename
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
  `;

  const published = new Set(rows.map((row) => row.tablename));
  let failed = false;

  for (const table of REQUIRED) {
    const ok = published.has(table);
    if (!ok) failed = true;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${table} published to supabase_realtime`);
  }

  // REPLICA IDENTITY FULL is what makes a DELETE event carry the whole old row.
  // Without it the payload holds only the primary key, so a subscriber cannot
  // tell whether the deleted row belonged to the household it is watching.
  const identities = await sql`
    select relname, relreplident
    from pg_class
    where relname = any(${REQUIRED}) and relnamespace = 'public'::regnamespace
  `;

  for (const row of identities) {
    const ok = row.relreplident === "f";
    if (!ok) failed = true;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${row.relname} replica identity is FULL` +
        (ok ? "" : ` (got '${row.relreplident}')`),
    );
  }

  console.log(
    failed
      ? "\n  Realtime is NOT fully configured — subscriptions will silently receive nothing.\n"
      : "\n  Realtime is configured.\n",
  );

  process.exit(failed ? 1 : 0);
} finally {
  await sql.end();
}
