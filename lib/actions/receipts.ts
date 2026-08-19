"use server";

/**
 * Receipt attachment.
 * =============================================================================
 * The file itself never passes through this server. The browser uploads it
 * straight to Supabase Storage and then calls `attachReceipt` with the resulting
 * path — a few dozen bytes instead of a few megabytes.
 *
 * That is not only a bandwidth argument. Routing the bytes through a Server
 * Action would mean the file is form-encoded into a request that Vercel caps at
 * 4.5MB, so a photo from a modern phone camera would fail on a limit unrelated
 * to the 5MB the bucket actually allows — and the failure would be a platform
 * error page rather than something this code could turn into a sentence.
 *
 * Security does not depend on the upload being direct or proxied. The same
 * storage RLS policy runs either way: the browser holds the anon key, and
 * `receipts_insert` only permits a path whose first segment is a household the
 * caller belongs to.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUser } from "@/lib/auth";
import { fromDatabaseError } from "@/lib/errors";
import { failures, ok, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/households";

/**
 * The path must be exactly `{householdId}/{expenseId}/{uuid}.{ext}`.
 *
 * Re-validated here even though storage already enforced the household segment
 * on upload, because this action writes the path into `expenses.receipt_path`
 * and that column is later handed to `createSignedUrl`. A client that sent a
 * path pointing at another household's object would otherwise have persuaded
 * this row to reference a file its viewers should not see. Storage's policy
 * guards the write; this guards the reference.
 */
const receiptPathSchema = z
  .string()
  .regex(
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i,
    "That file could not be attached",
  );

const attachSchema = z.object({
  householdId: uuidSchema,
  expenseId: uuidSchema,
  path: receiptPathSchema,
});

export async function attachReceipt(input: unknown): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = attachSchema.safeParse(input);
  if (!parsed.success) return failures.validation("That file could not be attached");

  const { householdId, expenseId, path } = parsed.data;

  // The path's own segments must match the expense it is being attached to.
  // Without this a member could attach a receipt belonging to a different
  // expense in the same household — legal for storage, wrong for the ledger.
  if (!path.startsWith(`${householdId}/${expenseId}/`)) {
    return failures.validation("That file could not be attached");
  }

  const supabase = await createClient();

  // No explicit permission check: `expenses_update` already restricts this to
  // the payer, the creator and household admins via `can_modify_expense`. A
  // check here would be a second copy of that rule, free to drift from it.
  const { error } = await supabase
    .from("expenses")
    .update({ receipt_path: path })
    .eq("id", expenseId)
    .eq("household_id", householdId);

  if (error) return fromDatabaseError(error, "attachReceipt");

  revalidatePath(`/app/households/${householdId}/expenses/${expenseId}`);

  return ok(undefined as never);
}

/**
 * Detaches a receipt and deletes the underlying object.
 *
 * The reference is cleared first. If the storage delete then fails the result is
 * an orphaned object — invisible, costing a few kilobytes — whereas doing it the
 * other way round and failing would leave a row pointing at a file that no
 * longer exists, which renders as a broken image on the expense forever.
 */
export async function removeReceipt(input: unknown): Promise<ActionResult<never>> {
  const user = await getUser();
  if (!user) return failures.unauthenticated();

  const parsed = attachSchema.safeParse(input);
  if (!parsed.success) return failures.validation("That receipt could not be removed");

  const { householdId, expenseId, path } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase
    .from("expenses")
    .update({ receipt_path: null })
    .eq("id", expenseId)
    .eq("household_id", householdId);

  if (error) return fromDatabaseError(error, "removeReceipt");

  const { error: storageError } = await supabase.storage
    .from("receipts")
    .remove([path]);
  if (storageError) {
    console.error("[storage] orphaned receipt", path, storageError.message);
  }

  revalidatePath(`/app/households/${householdId}/expenses/${expenseId}`);

  return ok(undefined as never);
}

/**
 * A short-lived URL that renders the receipt image.
 *
 * The bucket is private, so there is no permanent URL to store — and that is the
 * point. A public bucket would mean anyone holding the URL could read a document
 * that routinely carries an address, a card's last four digits and a full list
 * of what somebody bought. Signing on each render keeps the object reachable
 * only by someone who has just passed RLS to load the page it appears on.
 *
 * One hour is long enough that the image will not expire while the page is open,
 * and short enough that a URL copied out of devtools stops working the same day.
 */
export async function getReceiptUrl(path: string): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(path, 60 * 60);

  if (error) {
    console.error("[storage] could not sign receipt", error.message);
    return null;
  }

  return data.signedUrl;
}
