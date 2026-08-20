/**
 * The notification centre — every recent notification, not just the bell's
 * dropdown-sized slice.
 * =============================================================================
 * At `/app/notifications` rather than nested under a household, for the same
 * reason as `/app/settings`: notifications span every household a person
 * belongs to, so the page that lists all of them belongs at the account
 * level, not the household level.
 */

import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";
import { getHouseholdsForUser } from "@/lib/data/households";
import { getNotifications, NOTIFICATION_CENTRE_LIMIT } from "@/lib/data/notifications";
import { NotificationList } from "@/components/notifications/notification-list";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/app/notifications");

  const [notifications, households] = await Promise.all([
    getNotifications(NOTIFICATION_CENTRE_LIMIT),
    getHouseholdsForUser(),
  ]);

  const currencies = Object.fromEntries(
    households.map((household) => [household.id, household.currency]),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          Everything that happened across every household you&rsquo;re in.
        </p>
      </div>

      <NotificationList initial={notifications} currencies={currencies} />
    </div>
  );
}
