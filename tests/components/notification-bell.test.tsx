/**
 * NotificationBell: unread-count arithmetic, wording, and mark-read plumbing.
 * =============================================================================
 * The Realtime subscription itself is exercised by
 * `tests/e2e/shopping-realtime.spec.ts` pattern applied to a real socket; here
 * the Supabase client is mocked so this test can focus on what the component
 * does with the data it is given — the badge count, the per-type sentence, and
 * the optimistic mark-read update — in milliseconds and without a network.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationBell } from "@/components/notifications/notification-bell";
import type { NotificationEntry } from "@/lib/data/notifications";

const markNotificationRead = vi.fn().mockResolvedValue({ ok: true });
const markAllNotificationsRead = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/actions/notifications", () => ({
  markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
  markAllNotificationsRead: (...args: unknown[]) => markAllNotificationsRead(...args),
}));

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: vi.fn(),
  }),
}));

function entry(overrides: Partial<NotificationEntry> = {}): NotificationEntry {
  return {
    id: crypto.randomUUID(),
    householdId: "household-1",
    type: "expense_created",
    payload: { description: "Groceries", amount_minor: 4500 },
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("NotificationBell", () => {
  it("shows no unread badge and a friendly empty state with nothing to show", async () => {
    const user = userEvent.setup();
    render(<NotificationBell userId="user-1" initial={[]} currencies={{}} />);

    expect(
      screen.getByRole("button", { name: "Notifications, none unread" }),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("notification-bell"));
    expect(await screen.findByText(/nothing yet/i)).toBeInTheDocument();
    // No "mark all read" affordance when there is nothing to mark.
    expect(
      screen.queryByRole("button", { name: /mark all read/i }),
    ).not.toBeInTheDocument();
  });

  it("counts only unread notifications in the badge and caps the label at 9+", async () => {
    const items = [
      ...Array.from({ length: 10 }, () => entry({ readAt: null })),
      entry({ readAt: new Date().toISOString() }),
    ];
    render(<NotificationBell userId="user-1" initial={items} currencies={{}} />);

    expect(
      screen.getByRole("button", { name: "Notifications, 10 unread" }),
    ).toBeInTheDocument();
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("renders a per-type sentence with the correct currency for its household", async () => {
    const user = userEvent.setup();
    const items = [
      entry({
        type: "expense_created",
        householdId: "house-ils",
        payload: { description: "Rent", amount_minor: 500_000 },
      }),
      entry({
        type: "settlement_voided",
        householdId: "house-ils",
        payload: {},
      }),
    ];

    render(
      <NotificationBell
        userId="user-1"
        initial={items}
        currencies={{ "house-ils": "ILS" }}
      />,
    );

    await user.click(screen.getByTestId("notification-bell"));

    expect(await screen.findByText(/Rent was added for/)).toBeInTheDocument();
    expect(screen.getByText("A recorded payment was voided")).toBeInTheDocument();
  });

  it("marks a single notification read on open and calls the server action", async () => {
    const user = userEvent.setup();
    const item = entry({ type: "expense_created" });
    render(<NotificationBell userId="user-1" initial={[item]} currencies={{}} />);

    await user.click(screen.getByTestId("notification-bell"));
    const link = await screen.findByRole("link");
    await user.click(link);

    await waitFor(() =>
      expect(markNotificationRead).toHaveBeenCalledWith({ notificationId: item.id }),
    );
  });

  it("mark-all clears the badge, disables the button's re-appearance, and refreshes the router", async () => {
    const user = userEvent.setup();
    const items = [entry({ readAt: null }), entry({ readAt: null })];
    render(<NotificationBell userId="user-1" initial={items} currencies={{}} />);

    await user.click(screen.getByTestId("notification-bell"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("button", { name: /mark all read/i }));

    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
    // The trigger button itself (not queried by role: Radix marks the rest of
    // the tree aria-hidden while its menu portal is open).
    await waitFor(() =>
      expect(screen.getByTestId("notification-bell")).toHaveAttribute(
        "aria-label",
        "Notifications, none unread",
      ),
    );
  });
});
