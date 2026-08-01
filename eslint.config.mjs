/**
 * ESLint configuration for SplitMate.
 * -----------------------------------------------------------------------------
 * Beyond the Next.js defaults, this config encodes two *architectural*
 * boundaries as lint rules. Both are documented in docs/03-technical-spec.md,
 * and both exist because a violation would be a security or correctness bug
 * rather than a style problem — so they are errors, not warnings.
 *
 *   1. The domain layer (lib/domain/**) must stay pure. It may not import
 *      React, Next.js or Supabase. Purity is what lets us unit-test the money
 *      and split algorithms exhaustively with no database and no rendering.
 *
 *   2. The service-role Supabase client (lib/supabase/admin.ts) bypasses Row
 *      Level Security. It must never be reachable from anything that could be
 *      bundled for the browser, because shipping that key would hand every
 *      visitor unrestricted read/write access to the entire database.
 */

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    // Generated from the database schema by the Supabase CLI; not hand-written.
    "lib/supabase/database.types.ts",
  ]),

  {
    rules: {
      // Unused variables are usually a leftover from a refactor. Allow the
      // conventional leading underscore for intentionally ignored bindings.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // `console.log` left in server code leaks into production logs; warn and
      // allow the deliberate levels we actually use for observability.
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      // Enforce type-only imports so types never survive into the JS bundle.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },

  /* --- Boundary 1: the domain layer stays framework-free ------------------ */
  {
    files: ["lib/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-dom",
                "next",
                "next/*",
                "@supabase/*",
                "@/lib/supabase/*",
                "@/lib/data/*",
                "@/lib/actions/*",
                "@/components/*",
                "@/app/*",
              ],
              message:
                "lib/domain must stay pure: no framework, database or UI imports. " +
                "This is what makes the money and split algorithms testable in isolation.",
            },
          ],
        },
      ],
    },
  },

  /* --- Developer scripts are command-line tools, not application code ----- */
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      // These run in a terminal and their entire output *is* stdout, so the
      // rule that stops stray logging reaching production logs does not apply.
      "no-console": "off",
    },
  },

  /* --- Boundary 2: the service-role key never reaches the client ---------- */
  {
    files: ["components/**/*.{ts,tsx}", "app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message:
                "The service-role client bypasses Row Level Security and must never be " +
                "imported from a component. Use @/lib/supabase/server (the caller's JWT) instead.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
