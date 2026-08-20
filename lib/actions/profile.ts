"use server";

/**
 * Editing your own profile — display name and avatar.
 * =============================================================================
 * The only write this file makes is to the caller's own row, and it stays that
 * way even if the query below were rewritten carelessly: `profiles_update_own`
 * (`supabase/migrations/20260801120200_rls_policies.sql`) restricts UPDATE to
 * `id = auth.uid()` at the database level, so this is defence in depth rather
 * than the actual boundary.
 */

import { revalidatePath } from "next/cache";

import { getUser } from "@/lib/auth";
import { fromDatabaseError } from "@/lib/errors";
import { fail, failures, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/auth";
import { updateProfileSchema } from "@/lib/validation/profile";

export async function updateProfile(
  _previousState: ActionResult<{ displayName: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ displayName: string }>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = updateProfileSchema.safeParse({
    displayName: formData.get("displayName"),
    avatarUrl: formData.get("avatarUrl"),
  });

  if (!parsed.success) {
    return fail("VALIDATION", "Check the details below", toFieldErrors(parsed.error));
  }

  const { displayName, avatarUrl } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName, avatar_url: avatarUrl })
    .eq("id", user.id)
    .select("display_name")
    .maybeSingle();

  if (error) return fromDatabaseError(error, "updateProfile");
  if (!data) return failures.forbidden("update this profile");

  // Every page that shows your name or avatar reads it from a Server
  // Component (`app-header.tsx`, every membership list) rather than from
  // client state, so a layout-wide revalidation is what makes a rename show
  // up anywhere but the settings page itself without a full reload.
  revalidatePath("/", "layout");

  return ok({ displayName: data.display_name });
}
