"use server";

/**
 * Marking notifications as read.
 * =============================================================================
 * The only writes a user makes to their own notifications. Creation is not here
 * and deliberately cannot be: `notifications` has no INSERT policy at all, so the
 * sole way a row appears is `notify_users`, a SECURITY DEFINER function called
 * from inside the RPCs that actually change something.
 *
 * That closes an attack that is easy to miss. If clients could insert, any member
 * could write a notification into another member's bell saying whatever they
 * liked — "Your rent payment was received" is a convincing thing to read from an
 * app you trust. Restricting creation to the code path that performs the
 * underlying action means a notification cannot describe an event that did not
 * happen.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUser } from "@/lib/auth";
import { fromDatabaseError } from "@/lib/errors";
import { failures, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/households";

const markReadSchema = z.object({ notificationId: uuidSchema });

export async function markNotificationRead(
  input: unknown,
): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = markReadSchema.safeParse(input);
  if (!parsed.success)
    return failures.validation("That notification could not be found");

  const supabase = await createClient();

  // No `.eq("user_id", ...)`: `notifications_update` already restricts this to
  // rows the caller owns, and repeating the rule here would be a second copy
  // free to drift from the policy. An attempt on someone else's row matches
  // nothing and succeeds vacuously, which is the correct outcome — it neither
  // changes anything nor confirms the row exists.
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.notificationId)
    .is("read_at", null);

  if (error) return fromDatabaseError(error, "markNotificationRead");

  return ok(undefined as never);
}

/**
 * Clears the badge in one action.
 *
 * Worth its own action rather than looping the single-row one on the client:
 * twenty round trips to clear twenty notifications is twenty chances to fail
 * halfway and leave a badge showing a number that no longer means anything.
 */
export async function markAllNotificationsRead(): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const supabase = await createClient();

  // `user_id` IS specified here, unlike above. Without a filter this UPDATE has
  // no WHERE clause of its own and relies entirely on RLS to scope it — true
  // today, catastrophic the day someone grants this table a broader policy. A
  // statement that would be harmless under any policy is worth the redundancy.
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) return fromDatabaseError(error, "markAllNotificationsRead");

  revalidatePath("/app", "layout");

  return ok(undefined as never);
}
