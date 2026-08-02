/**
 * Ambient declarations for the environment variables SplitMate uses.
 * -----------------------------------------------------------------------------
 * This file exists for two concrete reasons, not merely for tidiness:
 *
 *  1. `NodeJS.ProcessEnv` carries an index signature (`[key: string]: string |
 *     undefined`). Because tsconfig enables `noPropertyAccessFromIndexSignature`,
 *     dot access would otherwise be a type error. Declaring the keys here makes
 *     them real properties, so `process.env.NEXT_PUBLIC_SUPABASE_URL` type-checks
 *     and a typo in a variable name becomes a compile error instead of a
 *     mysterious `undefined` at runtime.
 *
 *  2. Next.js inlines client-visible variables at build time by statically
 *     replacing the expression `process.env.NEXT_PUBLIC_*`. That substitution
 *     matches dot access; bracket access is not guaranteed to be replaced. So
 *     the public variables *must* be read with dot notation, and this file is
 *     what makes that legal under our strict compiler settings.
 *
 * Runtime validation of these values lives in lib/env.ts — declaring a type
 * here only promises the shape, it does not prove the value is present.
 */

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /* ---- Public: inlined into the browser bundle ---- */

      /** Supabase project URL, e.g. https://abcdefgh.supabase.co */
      NEXT_PUBLIC_SUPABASE_URL?: string;
      /**
       * Supabase anonymous key. Public by design: it identifies the project but
       * grants no privileges of its own — every request it makes is still
       * filtered by Row Level Security. It is safe in the browser *only*
       * because RLS is enabled on every table.
       */
      NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
      /** Canonical site origin, used to build auth redirects and invite links. */
      NEXT_PUBLIC_SITE_URL?: string;
      /**
       * Injected by Vercel, not by us: the hostname (no scheme) that this
       * project's production deployment is served at. lib/env.ts falls back to
       * it so the site origin does not have to be maintained by hand.
       */
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?: string;

      /* ---- Server only: must never appear in a client bundle ---- */

      /**
       * Service-role key. Bypasses Row Level Security entirely. Used exclusively
       * by the scheduled recurring-expense job, which acts as the system rather
       * than as any user. Leaking this is a total compromise of the database.
       */
      SUPABASE_SERVICE_ROLE_KEY?: string;
      /** Shared secret proving a cron request really came from Vercel Cron. */
      CRON_SECRET?: string;
      /** Resend API key for transactional email (invitations, reminders). */
      RESEND_API_KEY?: string;
      /** Address invitations are sent from. */
      EMAIL_FROM?: string;

      /* ---- Tooling ---- */

      NODE_ENV: "development" | "production" | "test";
      /** Set by CI providers; used to tighten test behaviour. */
      CI?: string;
      /** Overrides the Playwright target so E2E can run against a deployment. */
      PLAYWRIGHT_BASE_URL?: string;
    }
  }
}

// `export {}` turns this file into a module, which is required for the
// `declare global` block above to be treated as an augmentation.
export {};
