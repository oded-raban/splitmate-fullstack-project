"use client";

/**
 * The notification bell.
 * =============================================================================
 * Subscribed to Postgres rather than polled. Polling for something that arrives
 * a few times a day means thousands of requests that find nothing — paid for on
 * every open tab, all day — to shave seconds off a latency nobody is measuring.
 * A WebSocket that stays quiet costs nothing until there is something to say.
 *
 * The subscription is filtered on `user_id`, and it has to be. Without the
 * filter every client would receive every notification in the database and
 * discard the ones that were not theirs — after they had already arrived in the
 * browser, which is a disclosure regardless of what the UI then did with them.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/actions/notifications";
import type { NotificationEntry } from "@/lib/data/notifications";
import { asMinor, formatMoney } from "@/lib/domain/money";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TimeAgo } from "@/components/common/time-ago";

interface NotificationBellProps {
  userId: string;
  initial: NotificationEntry[];
  /**
   * Currencies by household, so an amount is shown in the currency of the
   * household it belongs to rather than in whichever one this page happens to
   * be about. Someone in two households would otherwise read a correct number
   * with the wrong symbol, which is worse than showing no symbol at all.
   */
  currencies: Record<string, string>;
}

export function NotificationBell({
  userId,
  initial,
  currencies,
}: NotificationBellProps) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const supabase = useMemo(() => createClient(), []);

  /**
   * The server's list wins whenever it changes — after a navigation, or a
   * `router.refresh()`. Without this the bell keeps whatever it was hydrated
   * with and drifts from the database over a long session.
   *
   * Adjusted during render rather than in an effect. This is React's documented
   * pattern for resetting state when a prop changes, and the reason is visible:
   * an effect runs AFTER the browser has painted, so the bell would show the
   * stale list for one frame and then visibly correct itself. Setting state
   * during render makes React discard this render and redo it before anything
   * reaches the screen. The guard is what stops it looping — `initial` is a new
   * array identity only when the server actually sent one.
   */
  const [renderedFrom, setRenderedFrom] = useState(initial);
  if (renderedFrom !== initial) {
    setRenderedFrom(initial);
    setItems(initial);
  }

  useEffect(() => {
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;

          setItems((current) => {
            // Realtime can redeliver on reconnect, and a bell that counts the
            // same notification twice is a bell people stop believing.
            if (current.some((item) => item.id === row["id"])) return current;

            return [
              {
                id: row["id"] as string,
                householdId: (row["household_id"] as string | null) ?? null,
                type: row["type"] as NotificationEntry["type"],
                payload: (row["payload"] ?? {}) as Record<string, unknown>,
                readAt: null,
                createdAt: row["created_at"] as string,
              },
              ...current,
            ].slice(0, 20);
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  const unread = items.filter((item) => item.readAt === null);

  async function handleOpen(item: NotificationEntry) {
    if (item.readAt) return;

    // Marked locally first: the row is already being navigated away from, and
    // waiting for the server would show a notification still bold on a page the
    // user has just opened because of it.
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, readAt: new Date().toISOString() }
          : candidate,
      ),
    );

    await markNotificationRead({ notificationId: item.id });
  }

  async function handleMarkAll() {
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.readAt ? item : { ...item, readAt: now })),
    );

    await markAllNotificationsRead();
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unread.length
              ? `Notifications, ${unread.length} unread`
              : "Notifications, none unread"
          }
          data-testid="notification-bell"
        >
          <Bell className="size-4" />
          {unread.length ? (
            <span
              className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium tabular-nums"
              // Hidden from assistive tech because the count is already in the
              // button's accessible name; announcing it twice is noise.
              aria-hidden="true"
            >
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleMarkAll}
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </Button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">
            Nothing yet. You will hear about expenses that involve you.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((item) => {
              const href = linkFor(item);
              const currency = item.householdId
                ? (currencies[item.householdId] ?? "ILS")
                : "ILS";

              const body = (
                <>
                  <span className="flex items-start gap-2">
                    {item.readAt === null ? (
                      <span
                        className="bg-primary mt-1.5 size-1.5 shrink-0 rounded-full"
                        aria-hidden="true"
                      />
                    ) : (
                      <span className="mt-1.5 size-1.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-sm",
                          item.readAt === null && "font-medium",
                        )}
                      >
                        {describe(item, currency)}
                      </span>
                      <TimeAgo
                        value={item.createdAt}
                        className="text-muted-foreground text-xs"
                      />
                    </span>
                  </span>
                </>
              );

              return (
                <li key={item.id} className="border-b last:border-b-0">
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => handleOpen(item)}
                      className="hover:bg-accent block px-3 py-2.5 transition-colors"
                    >
                      {body}
                    </Link>
                  ) : (
                    <span className="block px-3 py-2.5">{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Where a notification takes you.
 *
 * Every notification that refers to something should be a way of getting to it —
 * a bell that tells you rent was added and then makes you find it yourself is a
 * worse version of not being told.
 *
 * Exported: `/app/notifications` (the full notification centre) reuses this
 * rather than re-deriving the same routing rules a second time.
 */
export function linkFor(item: NotificationEntry): string | null {
  if (!item.householdId) return null;
  const base = `/app/households/${item.householdId}`;
  const expenseId = item.payload["expense_id"];

  switch (item.type) {
    case "expense_created":
    case "expense_updated":
    case "recurring_generated":
      return typeof expenseId === "string" ? `${base}/expenses/${expenseId}` : base;
    case "expense_deleted":
      // Deliberately not the expense: it is soft-deleted, so that page is gone.
      return `${base}/expenses`;
    case "settlement_recorded":
    case "settlement_voided":
      return `${base}/settle`;
    case "invite_accepted":
    case "member_joined":
    case "member_removed":
      return `${base}/members`;
    default:
      return base;
  }
}

/**
 * Turns a row into a sentence, from `type` and `payload` rather than stored
 * prose. Exported for the same reason as `linkFor` above.
 */
export function describe(item: NotificationEntry, currency: string): string {
  const description =
    typeof item.payload["description"] === "string"
      ? item.payload["description"]
      : "an expense";

  const raw = item.payload["amount_minor"];
  const amount =
    typeof raw === "number" ||
    (typeof raw === "string" && Number.isInteger(Number(raw)))
      ? formatMoney(asMinor(Number(raw)), currency)
      : null;

  switch (item.type) {
    case "expense_created":
      return `${description} was added${amount ? ` for ${amount}` : ""}`;
    case "expense_updated":
      return `${description} was edited`;
    case "expense_deleted":
      return `${description} was deleted`;
    case "recurring_generated":
      return `${description} was added automatically${amount ? ` for ${amount}` : ""}`;
    case "settlement_recorded":
      return `A payment${amount ? ` of ${amount}` : ""} was recorded`;
    case "settlement_voided":
      return "A recorded payment was voided";
    case "invite_accepted":
      return "Your invitation was accepted";
    case "member_joined":
      return "Someone joined the household";
    case "member_removed":
      return "A member was removed from the household";
    default:
      return "Something changed in your household";
  }
}
