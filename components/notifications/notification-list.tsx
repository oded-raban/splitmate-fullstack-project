"use client";

/**
 * The full notification centre at `/app/notifications`.
 * =============================================================================
 * Deliberately not the same component as the header's `NotificationBell`,
 * even though the two render nearly identical rows: the bell's job is a live,
 * always-mounted badge, so it holds a Realtime subscription that has to stay
 * open for the lifetime of every page in the app. A full-page list that is
 * only ever mounted once, on a page the user navigated to specifically to
 * read it, does not need that subscription open twice at once — this just
 * reads what the server sent and lets `router.refresh()` (via marking read)
 * catch up on the next navigation. `describe()` and `linkFor()` are imported
 * from the bell rather than redefined, so "what a notification says" cannot
 * drift between the two surfaces.
 */

import { useState } from "react";
import Link from "next/link";
import { CheckCheck } from "lucide-react";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/actions/notifications";
import type { NotificationEntry } from "@/lib/data/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/common/time-ago";
import { describe, linkFor } from "@/components/notifications/notification-bell";

interface NotificationListProps {
  initial: NotificationEntry[];
  currencies: Record<string, string>;
}

export function NotificationList({ initial, currencies }: NotificationListProps) {
  const [items, setItems] = useState(initial);
  const unreadCount = items.filter((item) => item.readAt === null).length;

  async function handleOpen(item: NotificationEntry) {
    if (item.readAt) return;

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
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        Nothing yet. You will hear about expenses that involve you.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {unreadCount > 0 ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={handleMarkAll}>
            <CheckCheck className="size-4" />
            Mark all as read
          </Button>
        </div>
      ) : null}

      <ul className="divide-border bg-card divide-y rounded-lg border">
        {items.map((item) => {
          const href = linkFor(item);
          const currency = item.householdId
            ? (currencies[item.householdId] ?? "ILS")
            : "ILS";

          const body = (
            <span className="flex items-start gap-3 px-4 py-3">
              {item.readAt === null ? (
                <span
                  className="bg-primary mt-1.5 size-2 shrink-0 rounded-full"
                  aria-hidden="true"
                />
              ) : (
                <span className="mt-1.5 size-2 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn("block text-sm", item.readAt === null && "font-medium")}
                >
                  {describe(item, currency)}
                </span>
                <TimeAgo
                  value={item.createdAt}
                  className="text-muted-foreground text-xs"
                />
              </span>
            </span>
          );

          return (
            <li key={item.id}>
              {href ? (
                <Link
                  href={href}
                  onClick={() => handleOpen(item)}
                  className="hover:bg-accent block transition-colors"
                  data-testid="notification-row"
                >
                  {body}
                </Link>
              ) : (
                <div data-testid="notification-row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
