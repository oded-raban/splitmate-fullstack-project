/**
 * Playwright configuration — end-to-end tests.
 * -----------------------------------------------------------------------------
 * These tests drive a real browser against a real server and a real database.
 * They are the only tests that prove a *workflow* works end to end: sign in,
 * create a household, invite a roommate, log an expense, settle up.
 *
 * The reason Playwright was chosen over alternatives is `browser.newContext()`:
 * it gives each simulated roommate a completely isolated cookie jar in a single
 * test. That is what lets us assert that a shopping-list item added by Maya
 * appears live in Yonatan's browser — the multi-user behaviour that is the
 * heart of the product and is untestable with a single session.
 */

import { defineConfig, devices } from "@playwright/test";

// Tests run against a locally started dev server by default, but CI points at
// the Vercel preview deployment for the branch instead.
const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000";
const isCI = !!process.env["CI"];

export default defineConfig({
  testDir: "./tests/e2e",

  // A workflow test that hangs should fail fast rather than stall the run.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Retries mask flakiness locally, so only CI retries (where a cold serverless
  // start or a slow network genuinely can cause a one-off failure).
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,

  // `forbidOnly` stops a stray `test.only` from silently reducing CI to one test.
  forbidOnly: isCI,

  reporter: isCI
    ? [["html", { open: "never" }], ["github"]]
    : [["html", { open: "never" }], ["list"]],

  use: {
    baseURL,
    // Artefacts are kept only for failures, which keeps the report small while
    // still giving a full trace to debug the one test that broke.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    testIdAttribute: "data-testid",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The primary real-world context for this product is a phone in a shop,
    // so the mobile viewport is a first-class target rather than an afterthought.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],

  // Start the app automatically unless we were pointed at a deployed URL.
  webServer: process.env["PLAYWRIGHT_BASE_URL"]
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
});
