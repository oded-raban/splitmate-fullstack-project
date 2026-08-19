"use client";

/**
 * Receipt upload and preview.
 * =============================================================================
 * Uploads straight from the browser to Supabase Storage, then tells the server
 * where the file landed. See lib/actions/receipts.ts for why the bytes do not go
 * through a Server Action.
 *
 * Everything here is validated twice on purpose. The checks in this file exist
 * to produce a sentence a person can act on — "that file is 12MB, the limit is
 * 5MB" — before a round trip. The bucket's own `file_size_limit` and
 * `allowed_mime_types` are what actually enforce it, because a client-side check
 * is a convenience that anyone with devtools can skip.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileImage, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { attachReceipt, removeReceipt } from "@/lib/actions/receipts";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

/** Mirrors the bucket's `allowed_mime_types`. */
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/** Mirrors the bucket's `file_size_limit` of 5MB. */
const MAX_BYTES = 5 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface ReceiptPanelProps {
  householdId: string;
  expenseId: string;
  /** A signed URL, resolved on the server. Null when no receipt is attached. */
  receiptUrl: string | null;
  receiptPath: string | null;
  canModify: boolean;
}

export function ReceiptPanel({
  householdId,
  expenseId,
  receiptUrl,
  receiptPath,
  canModify,
}: ReceiptPanelProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so that picking the same file twice — after a failure —
    // still fires a change event.
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED.includes(file.type)) {
      toast.error("Receipts must be a JPEG, PNG or WebP image");
      return;
    }

    if (file.size > MAX_BYTES) {
      const megabytes = (file.size / 1024 / 1024).toFixed(1);
      toast.error(`That image is ${megabytes}MB. The limit is 5MB.`);
      return;
    }

    setIsUploading(true);

    // `{householdId}/{expenseId}/{uuid}.{ext}` — the shape the storage policies
    // parse and `attachReceipt` re-validates. The random filename means two
    // people photographing the same receipt cannot collide, and that the object
    // name leaks nothing about its contents.
    const path = `${householdId}/${expenseId}/${crypto.randomUUID()}.${EXTENSIONS[file.type]}`;

    const supabase = createClient();
    const { error } = await supabase.storage.from("receipts").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

    if (error) {
      setIsUploading(false);
      toast.error(
        error.message.includes("exceeded")
          ? "That image is too large. The limit is 5MB."
          : "The upload failed. Try again.",
      );
      return;
    }

    const result = await attachReceipt({ householdId, expenseId, path });
    setIsUploading(false);

    if (!result.ok) {
      // The object uploaded but the row was not updated, so nothing references
      // it. Removing it here keeps the bucket from accumulating files no expense
      // will ever show.
      await supabase.storage.from("receipts").remove([path]);
      toast.error(result.error.message);
      return;
    }

    toast.success("Receipt attached");
    router.refresh();
  }

  // No transition of its own: ConfirmDialog holds the pending state for the
  // duration of this promise and disables its own button accordingly.
  async function handleRemove() {
    if (!receiptPath) return;

    const result = await removeReceipt({ householdId, expenseId, path: receiptPath });

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success("Receipt removed");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receipt</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {receiptUrl ? (
          <>
            {/*
              A plain <img>, not next/image. The URL is signed and expires within
              the hour, so Next's optimiser would cache a transformed copy under
              a key that outlives the credential it was fetched with — caching a
              private document on a public CDN path.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receiptUrl}
              alt="The receipt for this expense"
              className="max-h-96 w-full rounded-md border object-contain"
            />

            {canModify ? (
              <ConfirmDialog
                title="Remove this receipt?"
                description="The image will be deleted. The expense itself stays as it is."
                confirmLabel="Remove"
                onConfirm={handleRemove}
                trigger={
                  <Button variant="outline" size="sm">
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                }
              />
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <FileImage
              className="text-muted-foreground size-8"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <p className="text-muted-foreground text-sm">
              {canModify
                ? "Attach a photo so nobody has to take your word for the amount."
                : "No receipt was attached to this expense."}
            </p>

            {canModify ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED.join(",")}
                  className="sr-only"
                  onChange={handleFile}
                  aria-label="Choose a receipt image"
                  data-testid="receipt-input"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => inputRef.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="size-4" />
                      Add a receipt
                    </>
                  )}
                </Button>
              </>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
