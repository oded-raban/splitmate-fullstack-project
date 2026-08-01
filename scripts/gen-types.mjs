/**
 * Regenerates lib/supabase/database.types.ts from the live database schema.
 * =============================================================================
 * Run with `npm run db:types`, and run it after every migration: a stale copy
 * of the generated file means TypeScript will happily agree with queries the
 * database will reject at runtime.
 *
 * The Supabase CLI offers two ways to read a schema, and this script prefers
 * them in the order below because only the first works without Docker:
 *
 *   1. `--project-id`, which reads the schema over the Management API using a
 *      personal access token (SUPABASE_ACCESS_TOKEN).
 *   2. `--db-url`, which connects to Postgres directly but runs postgres-meta
 *      inside a container, so it needs Docker Desktop running.
 *
 * Two things this does that a plain `supabase gen types … > file` redirect does
 * not:
 *
 *   - Writes UTF-8 without a BOM. PowerShell's `>` operator emits UTF-16LE,
 *     which TypeScript refuses to parse — a silent trap for anyone on Windows.
 *   - Only overwrites the output once the CLI has produced something that looks
 *     like the generated module, so a dropped connection cannot leave a
 *     truncated types file behind and break every import in the project.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(projectRoot, "lib/supabase/database.types.ts");
const envPath = resolve(projectRoot, ".env.local");

function fail(message) {
  console.error(`\n  db:types failed\n\n  ${message}\n`);
  process.exit(1);
}

/** Reads a single key from .env.local, falling back to the real environment. */
function readEnv(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envPath)) return undefined;

  // A deliberately small parser: we need three keys, and the file is ours.
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }

  return undefined;
}

function buildArgs() {
  const accessToken = readEnv("SUPABASE_ACCESS_TOKEN");
  const projectRef = readEnv("SUPABASE_PROJECT_REF");

  if (accessToken && projectRef) {
    process.env.SUPABASE_ACCESS_TOKEN = accessToken;
    return ["--project-id", projectRef];
  }

  const databaseUrl = readEnv("SUPABASE_DB_URL");
  if (databaseUrl) return ["--db-url", databaseUrl];

  return fail(
    "No way to reach the schema.\n\n" +
      "  Set both of these in .env.local (preferred — no Docker required):\n" +
      "    SUPABASE_PROJECT_REF   Project Settings → General → Reference ID\n" +
      "    SUPABASE_ACCESS_TOKEN  https://supabase.com/dashboard/account/tokens\n\n" +
      "  Or set SUPABASE_DB_URL and start Docker Desktop.",
  );
}

const args = buildArgs();
console.log(`  Reading schema via ${args[0].replace("--", "")}…`);

const result = spawnSync(
  "npx",
  [
    "--no-install",
    "supabase",
    "gen",
    "types",
    "typescript",
    ...args,
    "--schema",
    "public",
  ],
  { encoding: "utf8", shell: true, maxBuffer: 32 * 1024 * 1024 },
);

const generated = result.stdout ?? "";

if (!generated.includes("export type Database")) {
  const detail = [result.stderr, generated]
    .map((stream) => (stream ?? "").trim())
    .filter(Boolean)
    .join("\n\n  ");

  fail(
    `The Supabase CLI exited with code ${result.status} and produced no schema.\n\n  ` +
      (detail || "It gave no output at all."),
  );
}

const banner = [
  "/**",
  " * GENERATED FILE — DO NOT EDIT.",
  " *",
  " * Produced by `npm run db:types` from the live database schema.",
  " */",
  "",
  "",
].join("\n");

writeFileSync(outputPath, banner + generated, { encoding: "utf8" });

const definitions = (generated.match(/^ {6}\w+: \{$/gm) ?? []).length;
console.log(`  Wrote lib/supabase/database.types.ts (${definitions} definitions)`);
