/**
 * Recent activity.
 * =============================================================================
 * Shared money runs on knowing what changed. A balance that moves without
 * explanation is the thing people argue about, so every write to the ledger
 * leaves an entry here and the feed is shown on the household's home page rather
 * than hidden behind a tab nobody opens.
 *
 * Entries are rendered from a machine-readable `action` plus a metadata blob
 * rather than from a stored sentence. Storing prose would freeze the wording at
 * the moment of writing, so improving a phrase later would leave the history
 * speaking in two voices — and a translation would be impossible.
 */

import Link from "next/link";

import type { ActivityEntry } from "@/lib/data/activity";
import type { MemberDetail } from "@/lib/data/households";
import { displayNameOf } from "@/lib/display";
import { asMinor, formatMoney } from "@/lib/domain/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeAgo } from "@/components/common/time-ago";

interface ActivityFeedProps {
  entries: ActivityEntry[];
  members: MemberDetail[];
  currency: string;
  viewerId: string;
  /** Present only where a full audit trail exists to link to. */
  householdId?: string;
}

export function ActivityFeed({
  entries,
  members,
  currency,
  viewerId,
  householdId,
}: ActivityFeedProps) {
  if (entries.length === 0) return null;

  const nameOf = (userId: string | null) => actorNameOf(userId, members, viewerId);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Recent activity</CardTitle>
        {householdId ? (
          <Link
            href={`/app/households/${householdId}/activity`}
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
          >
            View all
          </Link>
        ) : null}
      </CardHeader>
      <CardContent>
        <ul className="space-y-2.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-2 text-sm">
              <span className="bg-muted-foreground/40 mt-1.5 size-1.5 shrink-0 rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="text-foreground">
                  {describe(entry, nameOf(entry.actorId), currency)}
                </span>{" "}
                <TimeAgo value={entry.createdAt} className="text-muted-foreground" />
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * The best available name for whoever performed an action, from the
 * viewer's perspective — "You" for themselves, a former member's row may
 * already be gone from `members` by the time this renders, so that case
 * degrades to a label rather than a blank space.
 *
 * Exported for the same reason as `describe()` below: the full audit trail
 * page attributes entries to people exactly the way this card does.
 */
export function actorNameOf(
  userId: string | null,
  members: MemberDetail[],
  viewerId: string,
): string {
  if (!userId) return "Someone";
  if (userId === viewerId) return "You";
  const member = members.find((candidate) => candidate.userId === userId);
  return member ? displayNameOf(member) : "A former member";
}

/**
 * Turns one row into a sentence.
 *
 * Falls through to a generic phrasing rather than throwing on an unrecognised
 * action: a feed that breaks the page because a newer version of the app wrote
 * an entry this one has no wording for would be a poor trade.
 *
 * Exported so `/app/households/[id]/activity` (the full audit trail) renders
 * entries with the exact same wording as this card, rather than a second copy
 * of the same switch statement that could drift from it.
 */
export function describe(
  entry: ActivityEntry,
  actor: string,
  currency: string,
): string {
  const description =
    typeof entry.metadata["description"] === "string"
      ? entry.metadata["description"]
      : null;

  const rawAmount = entry.metadata["amount_minor"];
  const amount =
    typeof rawAmount === "number"
      ? formatMoney(asMinor(rawAmount), currency)
      : typeof rawAmount === "string" && Number.isInteger(Number(rawAmount))
        ? formatMoney(asMinor(Number(rawAmount)), currency)
        : null;

  const key = `${entry.entityType}.${entry.action}`;

  switch (key) {
    case "expense.created":
      return `${actor} added ${description ?? "an expense"}${amount ? ` for ${amount}` : ""}`;
    case "expense.updated":
      return `${actor} edited ${description ?? "an expense"}`;
    case "expense.deleted":
      return `${actor} deleted ${description ?? "an expense"}`;
    case "settlement.created":
      return `${actor} recorded a payment${amount ? ` of ${amount}` : ""}`;
    case "settlement.voided":
      return `${actor} voided a payment`;
    case "member.joined":
      return `${actor} joined the household`;
    case "member.removed":
      return `${actor} removed a member`;
    case "household.created":
      return `${actor} created the household`;
    default:
      return `${actor} ${entry.action} ${entry.entityType.replace(/_/g, " ")}`;
  }
}
