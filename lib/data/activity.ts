/**
 * The household activity feed.
 * =============================================================================
 * `activity_log` has no INSERT policy at all — entries are written only by the
 * `log_activity` SECURITY DEFINER function, and there is no UPDATE or DELETE
 * policy either. A member can read the feed and can do nothing else to it, so an
 * entry cannot be forged to look like it came from somebody else, and cannot be
 * quietly removed once written.
 *
 * That is what makes this an audit trail rather than a list of notifications.
 */

import { createClient } from "@/lib/supabase/server";

export interface ActivityEntry {
  id: string;
  actorId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function getActivity(
  householdId: string,
  limit = 12,
): Promise<ActivityEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, actor_id, entity_type, entity_id, action, metadata, created_at")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[data] getActivity failed", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}
