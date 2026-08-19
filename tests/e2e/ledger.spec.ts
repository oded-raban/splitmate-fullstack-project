/**
 * The core ledger workflow, end to end: sign in, create a household, log an
 * expense, and settle up.
 * =============================================================================
 * This is the one test in the suite that proves a real person can complete
 * SplitMate's entire reason for existing through the actual UI — the RPCs and
 * RLS policies behind each step are already attacked directly in
 * tests/integration/, so this test is deliberately about the browser
 * experience layered on top of them, not a second copy of that coverage.
 *
 * Tests in this file run in sequence (`describe.serial`) and share one
 * household, because the settle-up step only makes sense after the expense
 * step has created a debt.
 */

import { expect, test } from "@playwright/test";

import { admin, cleanupE2eUsers, createE2eUser, signIn, type E2eUser } from "./fixtures";

let owner: E2eUser;
let roommate: E2eUser;
let householdId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  [owner, roommate] = await Promise.all([
    createE2eUser("owner"),
    createE2eUser("roommate"),
  ]);
});

test.afterAll(async () => {
  await cleanupE2eUsers();
});

test("signs in via magic link and lands on onboarding with no households yet", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.waitForURL(/\/onboarding|\/app/);
  await expect(page.getByTestId("household-name")).toBeVisible();
});

test("creates a household and becomes its owner", async ({ page }) => {
  await signIn(page, owner);
  await page.waitForURL("**/onboarding");

  await page.getByTestId("household-name").fill("Dizengoff 42 (E2E)");
  await page.getByRole("button", { name: /create household/i }).click();

  await page.waitForURL(/\/app\/households\/[0-9a-f-]+$/);
  householdId = new URL(page.url()).pathname.split("/").pop()!;
  expect(householdId).toBeTruthy();

  await expect(page.getByText(/the only one here/i)).toBeVisible();

  // Adding the second member through the invite UI is already covered by the
  // manual Phase 3 walkthrough (docs/README.md) and by the RPC-level
  // acceptance tests in tests/integration/invitations.test.ts; seeding it
  // directly here keeps this spec focused on the expense/settle workflow.
  await admin
    .from("household_members")
    .insert({ household_id: householdId, user_id: roommate.id, role: "member" });
});

test("logs an expense and both members see the resulting balance", async ({
  page,
  browser,
}) => {
  await signIn(page, owner);
  await page.goto(`/app/households/${householdId}/expenses/new`);

  await page.getByTestId("expense-description").fill("Weekly groceries (E2E)");
  await page.getByTestId("expense-amount").fill("100.00");
  await page.getByTestId("expense-submit").click();

  await page.waitForURL(/\/expenses$/);
  await expect(page.getByText("Weekly groceries (E2E)")).toBeVisible();

  await page.goto(`/app/households/${householdId}`);
  await expect(page.getByTestId(`balance-${owner.id}`)).toContainText("50.00");
  await expect(page.getByTestId(`balance-${roommate.id}`)).toContainText("50.00");

  // The roommate, in a completely separate signed-in context, sees the exact
  // same ledger fact — the point of a shared household rather than a private
  // expense tracker.
  const roommateContext = await browser.newContext();
  const roommatePage = await roommateContext.newPage();
  await signIn(roommatePage, roommate);
  await roommatePage.goto(`/app/households/${householdId}`);
  await expect(roommatePage.getByTestId(`balance-${owner.id}`)).toContainText("50.00");
  await roommateContext.close();
});

test("settles up and the balance returns to zero", async ({ page }) => {
  await signIn(page, roommate);
  await page.goto(`/app/households/${householdId}/settle`);

  await expect(page.getByTestId("settle-row")).toBeVisible();
  await page.getByRole("button", { name: "Record" }).click();

  await expect(page.getByTestId("settle-amount")).toHaveValue("50.00");
  await page.getByTestId("settle-submit").click();

  await page.waitForURL(/\/settle$/);
  await expect(page.getByText("Nothing to settle")).toBeVisible();

  await page.goto(`/app/households/${householdId}`);
  await expect(page.getByTestId(`balance-${owner.id}`)).toContainText("settled up");
  await expect(page.getByTestId(`balance-${roommate.id}`)).toContainText("settled up");
});
