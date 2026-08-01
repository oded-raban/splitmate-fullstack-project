/**
 * Vitest configuration.
 * -----------------------------------------------------------------------------
 * Two distinct kinds of test run through this config, and they need different
 * environments, so they are declared as separate *projects*:
 *
 *   • "unit"       — the pure domain layer (money, splits, balances, debt
 *                    simplification). No DOM, no database, no network. These
 *                    must run in milliseconds so they can be run on every save.
 *
 *   • "components" — React components via Testing Library. Needs a DOM, so it
 *                    runs in jsdom with the jest-dom matchers registered.
 *
 * Integration tests that hit a real Postgres with real RLS policies live in
 * tests/integration and are run by a separate command, because they require a
 * running Supabase instance and are far slower than everything above.
 */

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrors the "@/*" path alias in tsconfig.json so tests import modules
      // exactly the way application code does.
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    globals: true,
    // Fail a test that has no assertions rather than reporting a false pass.
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/components/**/*.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // RLS tests share a database; running them in parallel would let one
          // test's fixtures leak into another's assertions.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // We do not chase a global coverage number. What matters is that the
      // financially critical code is exhaustively covered, so the threshold is
      // scoped to the domain layer only.
      include: ["lib/domain/**/*.ts"],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
