/**
 * Full audit trail for a household.
 * =============================================================================
 * The home page's "Recent activity" card intentionally shows only a handful
 * of entries — it exists to answer "why did my balance just change?", not to
 * be a historical record. This page is the historical record: every entry
 * `activity_log` holds for the household, oldest activity still reachable by
 * scrolling rather than silently dropped past whatever the home page's limit
 * happens to be.
 *
 * Open to any member, matching `docs/02-architecture.md`'s route table — an
 * audit trail that only admins could read would defeat its own purpose in a
 * household where trust is exactly what is being verified.
 */

import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { requireMembership } from "@/lib/auth";
import { getActivity } from "@/lib/data/activity";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { actorNameOf, describe } from "@/components/activity/activity-feed";
import { EmptyState } from "@/components/common/empty-state";
import { TimeAgo } from "@/components/common/time-ago";

export const metadata = { title: "Activity" };

/**
 * A generous cap rather than true pagination — for the same reason
 * `NOTIFICATION_CENTRE_LIMIT` is a flat number: a household's full history is
 * a low-volume, per-household feed, and true cursor pagination is worth
 * building once a household's history is long enough to need it, which
 * `docs/05-scalability.md` §6 already names as a future addition rather than
 * a hidden gap.
 */
const ACTIVITY_LIMIT = 300;

export default async function HouseholdActivityPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const { user } = await requireMembership(householdId);

  const [household, activity] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getActivity(householdId, ACTIVITY_LIMIT),
  ]);
  if (!household) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Activity</h1>
        <p className="text-muted-foreground text-sm">
          Every change made to {household.name}&rsquo;s ledger, in order.
        </p>
      </div>

      {activity.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing recorded yet"
          description="Every expense, settlement and membership change will show up here as it happens."
        />
      ) : (
        <ul className="divide-border bg-card divide-y rounded-lg border">
          {activity.map((entry) => (
            <li key={entry.id} className="flex gap-2 px-4 py-3 text-sm">
              <span
                className="bg-muted-foreground/40 mt-1.5 size-1.5 shrink-0 rounded-full"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="text-foreground">
                  {describe(
                    entry,
                    actorNameOf(entry.actorId, household.members, user.id),
                    household.currency,
                  )}
                </span>{" "}
                <TimeAgo value={entry.createdAt} className="text-muted-foreground" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
