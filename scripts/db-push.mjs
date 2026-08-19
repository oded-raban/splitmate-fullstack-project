/**
 * Applies pending migrations to the linked Supabase project.
 * =============================================================================
 * Run with `npm run db:push`.
 *
 * This wrapper exists because `supabase db push` on its own reads its
 * credentials from the ambient environment, and this project keeps them in
 * .env.local. Without the wrapper the command's behaviour depends on whether the
 * shell it happens to run in was previously exported into — so it works for
 * whoever set it up and fails for everyone else, with an error
 * ("Cannot find project ref. Have you run supabase link?") that points at the
 * wrong problem entirely.
 *
 * Credentials are passed through the child process's environment rather than on
 * the command line: an argument vector is visible to any other process on the
 * machine that can list processes, and one of these values is the database
 * password.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env.local");

/** Reads a single key from .env.local, preferring a real environment variable. */
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

/**
 * The database password, taken from `SUPABASE_DB_PASSWORD` if it is set and
 * otherwise recovered from the connection string.
 *
 * Deriving it matters: `SUPABASE_DB_URL` already contains the password, and
 * requiring a second copy of the same secret means two places to rotate and one
 * of them will be missed. `URL` does the decoding, so a password containing a
 * percent-encoded character survives the round trip — hand-rolling the split
 * would corrupt exactly those passwords and produce an authentication failure
 * that looks like a wrong password rather than a parsing bug.
 */
function readDatabasePassword() {
  const explicit = readEnv("SUPABASE_DB_PASSWORD");
  if (explicit) return explicit;

  const url = readEnv("SUPABASE_DB_URL");
  if (!url) return undefined;

  try {
    return decodeURIComponent(new URL(url).password) || undefined;
  } catch {
    return undefined;
  }
}

const accessToken = readEnv("SUPABASE_ACCESS_TOKEN");
const projectRef = readEnv("SUPABASE_PROJECT_REF");
const dbPassword = readDatabasePassword();

// Reported as presence, never as value, so a CI log or a screen share cannot
// leak them — but a missing one is still diagnosable at a glance.
console.log(
  `  Credentials: token ${accessToken ? "found" : "MISSING"}, ` +
    `ref ${projectRef ? "found" : "MISSING"}, ` +
    `password ${dbPassword ? "found" : "MISSING"}`,
);

if (!accessToken || !projectRef || !dbPassword) {
  console.error(
    "\n  db:push failed\n\n" +
      "  These must be set in .env.local:\n" +
      "    SUPABASE_PROJECT_REF   Project Settings → General → Reference ID\n" +
      "    SUPABASE_ACCESS_TOKEN  https://supabase.com/dashboard/account/tokens\n" +
      "    SUPABASE_DB_URL        Project Settings → Database → Connection string\n" +
      "                           (or SUPABASE_DB_PASSWORD on its own)\n",
  );
  process.exit(1);
}

const cli = resolve(
  dirname(createRequire(import.meta.url).resolve("supabase/package.json")),
  "dist/supabase.js",
);

/**
 * Runs the Supabase CLI with credentials supplied through the environment.
 *
 * Never through `--password` or an inline connection string: an argument vector
 * is readable by any process on the machine that can list processes, and one of
 * these values is the database password.
 */
function supabase(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: accessToken,
      SUPABASE_DB_PASSWORD: dbPassword,
    },
  });
}

// Linking is done every time rather than assumed. It is idempotent and takes a
// moment, and the alternative is a first-run failure whose message
// ("Cannot find project ref. Have you run supabase link?") sends the reader
// looking for a setup step that this script is supposed to be handling. The
// link is also stored outside the repository, so a machine that has never run
// it — a fresh clone, or CI — has no way to know it is missing.
console.log(`  Linking to ${projectRef}…`);
const linked = supabase(["link", "--project-ref", projectRef]);

if (linked.status !== 0) {
  console.error("\n  db:push failed: could not link to the project.\n");
  process.exit(linked.status ?? 1);
}

// `--include-all` applies migrations missing from the remote history even when a
// later one has already been applied — which is what happens whenever two
// branches add migrations concurrently.
const result = supabase(["db", "push", "--linked", "--include-all", "--yes"]);

process.exit(result.status ?? 1);
