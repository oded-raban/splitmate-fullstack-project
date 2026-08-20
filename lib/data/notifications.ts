/**
 * Reads for the notification bell.
 * =============================================================================
 * Notifications are per-user, unlike the activity feed which is per-household.
 * The distinction is the point: the feed is a public record of what happened to
 * the household, and this is the subset that happened to YOU. `notifications_select`
 * enforces it — a member cannot read another member's notifications even within
 * a household they share.
 */

import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { NotificationType } from "@/lib/supabase/types";

export interface NotificationEntry {
  id: string;
  householdId: string | null;
  type: NotificationType;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/** How many the bell holds. Beyond this the answer is "a lot", not a number. */
const BELL_LIMIT = 20;

/**
 * How many the full `/app/notifications` centre loads. Higher than the bell's
 * because this is the one place someone goes specifically to catch up, but
 * still a fixed page rather than true pagination — a personal notification
 * feed a few times busier than this would be an unusual household, and this
 * is the same bet `docs/05-scalability.md` makes for every low-volume,
 * per-user feed rather than building pagination nothing currently needs.
 */
export const NOTIFICATION_CENTRE_LIMIT = 100;

/**
 * The viewer's most recent notifications across every household they belong to.
 *
 * Not scoped to one household on purpose: the bell lives in the app-wide header,
 * and someone who is in two households wants to know that rent was added to the
 * other one without having to navigate into it first.
 */
export async function getNotifications(
  limit: number = BELL_LIMIT,
): Promise<NotificationEntry[]> {
  const user = await getUser();
  if (!user) return [];

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("id, household_id, type, payload, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    // A failure here must not take the header — and therefore every page — down.
    // An empty bell is a worse experience than a full one and a better one than
    // an error screen on a working application.
    console.error("[data] getNotifications failed", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    householdId: row.household_id,
    type: row.type,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}
