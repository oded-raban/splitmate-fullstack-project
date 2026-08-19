/**
 * The shared shopping list actually shares, live, between two browsers.
 * =============================================================================
 * This is the one property in the whole product that a single-session test
 * cannot demonstrate: `browser.newContext()` gives each simulated roommate a
 * fully isolated cookie jar, so this test is two independent people, not one
 * person with two tabs. If either side ever manually called `router.refresh()`
 * to see the other's change, that would be the exact regression this exists to
 * catch.
 *
 * Household setup goes straight through the RPC layer (already covered by
 * tests/integration/) rather than the onboarding UI, so this spec's slow parts
 * are the two real WebSocket connections it needs, not incidental form-filling.
 */

import { expect, test } from "@playwright/test";

import {
  admin,
  cleanupE2eUsers,
  createE2eUser,
  signedInClient,
  signIn,
  type E2eUser,
} from "./fixtures";

let owner: E2eUser;
let roommate: E2eUser;
let householdId: string;

test.beforeAll(async () => {
  [owner, roommate] = await Promise.all([
    createE2eUser("shop-owner"),
    createE2eUser("shop-roommate"),
  ]);

  const ownerClient = await signedInClient(owner);
  const { data, error } = await ownerClient.rpc("create_household", {
    p_name: "Realtime Household",
  });
  if (error) throw error;
  householdId = data as string;

  await admin
    .from("household_members")
    .insert({ household_id: householdId, user_id: roommate.id, role: "member" });
});

test.afterAll(async () => {
  await cleanupE2eUsers();
});

test("an item added by one member appears live for another, with no refresh", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const roommateContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const roommatePage = await roommateContext.newPage();

  await signIn(ownerPage, owner);
  await signIn(roommatePage, roommate);

  await ownerPage.goto(`/app/households/${householdId}/shopping`);
  await roommatePage.goto(`/app/households/${householdId}/shopping`);

  // Both clients report a live Realtime connection before either acts —
  // otherwise a pass could just mean the second page loaded after the fact.
  await expect(ownerPage.getByText("Live")).toBeVisible();
  await expect(roommatePage.getByText("Live")).toBeVisible();

  const itemName = `Oat milk (${Date.now()})`;
  await ownerPage.getByTestId("shopping-input").fill(itemName);
  await ownerPage.getByTestId("shopping-add").click();

  // No reload, no manual action on the roommate's page — this either shows up
  // on its own within the timeout or the test fails.
  await expect(roommatePage.getByText(itemName)).toBeVisible({ timeout: 10_000 });

  await ownerContext.close();
  await roommateContext.close();
});

test("a tick by one member is attributed and visible to the other live", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const roommateContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const roommatePage = await roommateContext.newPage();

  await signIn(ownerPage, owner);
  await signIn(roommatePage, roommate);
  await ownerPage.goto(`/app/households/${householdId}/shopping`);
  await roommatePage.goto(`/app/households/${householdId}/shopping`);

  const itemName = `Sourdough (${Date.now()})`;
  await ownerPage.getByTestId("shopping-input").fill(itemName);
  await ownerPage.getByTestId("shopping-add").click();
  await expect(roommatePage.getByText(itemName)).toBeVisible({ timeout: 10_000 });

  const roommateRow = roommatePage
    .getByTestId("shopping-item")
    .filter({ hasText: itemName });
  await roommateRow.getByRole("checkbox").check();

  const ownerRow = ownerPage.getByTestId("shopping-item").filter({ hasText: itemName });
  await expect(ownerRow.getByText(/got by/i)).toBeVisible({ timeout: 10_000 });

  await ownerContext.close();
  await roommateContext.close();
});
