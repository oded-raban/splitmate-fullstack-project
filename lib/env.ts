/**
 * Validated environment configuration.
 * -----------------------------------------------------------------------------
 * Problem this module solves: a missing or malformed environment variable
 * normally fails far away from its cause — a `undefined` URL becomes a fetch
 * error deep inside the Supabase client, minutes after deploy, on one route.
 * Parsing every variable through a Zod schema at module load turns that into an
 * immediate, precise message naming the exact variable that is wrong.
 *
 * The split between `clientEnv` and `serverEnv()` is a security boundary, not
 * an organisational one:
 *
 *   • `clientEnv` holds only NEXT_PUBLIC_* values. These are inlined into the
 *     browser bundle by Next.js and are safe to expose.
 *
 *   • `serverEnv()` holds secrets and is a *function* rather than a constant so
 *     that its schema is never evaluated during a client render. It additionally
 *     throws if called in the browser, which converts an accidental import from
 *     a client component into a loud failure instead of a silent leak.
 *
 * See docs/03-technical-spec.md §13 for the full variable reference.
 */

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Public configuration                                                        */
/* -------------------------------------------------------------------------- */

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    error: "NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. https://xyz.supabase.co",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short to be a real key"),
  NEXT_PUBLIC_SITE_URL: z.url({
    error: "NEXT_PUBLIC_SITE_URL must be a full origin, e.g. http://localhost:3000",
  }),
});

/**
 * Note the dot access below: Next.js replaces `process.env.NEXT_PUBLIC_X`
 * textually at build time. Reading these through a variable or bracket notation
 * would leave them `undefined` in the browser. See types/env.d.ts.
 */
const clientParsed = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

if (!clientParsed.success) {
  // Thrown at import time, so the app fails to start rather than failing on the
  // first user request with an opaque error.
  throw new Error(
    formatIssues("Invalid public environment variables", clientParsed.error),
  );
}

export const clientEnv = clientParsed.data;

/* -------------------------------------------------------------------------- */
/* Server-only configuration                                                   */
/* -------------------------------------------------------------------------- */

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "SUPABASE_SERVICE_ROLE_KEY is required for the scheduled job"),
  CRON_SECRET: z
    .string()
    .min(16, "CRON_SECRET must be at least 16 characters to resist guessing"),
  // Email is optional in development so the app runs without a Resend account;
  // invitations then log the link to the console instead of sending it.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.email().optional(),
});

type ServerEnv = z.infer<typeof serverSchema>;

let cachedServerEnv: ServerEnv | undefined;

/**
 * Returns the validated server-only configuration.
 *
 * Lazy and cached: the schema is evaluated on first use, then memoised, so
 * importing this module from a shared file costs nothing until a secret is
 * actually needed.
 *
 * @throws if called in the browser, or if any secret is missing/malformed.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error(
      "serverEnv() was called in the browser. Server secrets must never be read " +
        "from client code — use clientEnv for public values.",
    );
  }

  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });

  if (!parsed.success) {
    throw new Error(formatIssues("Invalid server environment variables", parsed.error));
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Renders Zod issues as a readable, multi-line message.
 *
 * Deliberately prints the variable *names* and the reason, never the values —
 * an error report that echoes a secret back into a log is its own vulnerability.
 */
function formatIssues(heading: string, error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.join(".") || "(root)";
    return `  • ${key}: ${issue.message}`;
  });
  return `${heading}:\n${lines.join("\n")}\n\nCheck your .env.local against .env.example.`;
}

/** True when running the production build on Vercel. */
export const isProduction = process.env.NODE_ENV === "production";
