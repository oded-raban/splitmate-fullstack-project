"use client";

/**
 * Invitation dialog.
 * =============================================================================
 * The link is the product here, not the email. The realistic path to a working
 * household is one person pasting a link into the group chat the household
 * already uses, so the dialog's successful state is a copyable link rather than
 * a "we've sent an email" message the sender cannot verify.
 *
 * The email field is genuinely optional and the difference is spelled out,
 * because it changes who may accept: with an address the invitation is bound to
 * that person, without one it is a bearer link that works for whoever holds it.
 */

import { useActionState, useState } from "react";
import { Check, Copy, Link2, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { createInvitation, type CreatedInvitation } from "@/lib/actions/invitations";
import { ROLE_DESCRIPTIONS } from "@/lib/display";
import { type ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

const initialState: ActionResult<CreatedInvitation> | undefined = undefined;

export function InviteDialog({ householdId }: { householdId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createInvitation, initialState);
  const [copied, setCopied] = useState(false);
  // Controlled for the same reason as the currency select: Radix cannot render
  // an item's label until that item has mounted, so an uncontrolled default
  // leaves the trigger blank until the dropdown is opened.
  const [role, setRole] = useState<"member" | "admin">("member");

  const created = state?.ok ? state.data : undefined;
  const emailErrors =
    state?.ok === false ? state.error.fieldErrors?.["email"] : undefined;
  const formError =
    state?.ok === false && state.error.code !== "VALIDATION"
      ? state.error.message
      : undefined;

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invitation link copied");
    } catch {
      // Clipboard access is denied in some browsers and over plain HTTP. The
      // link is on screen and selectable, so this is a downgrade, not a failure.
      toast.error("Couldn't copy automatically — select the link and copy it.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reset here rather than in an effect on `open`: this is the event that
        // closes the dialog, so the reset belongs with it instead of being
        // rediscovered on the next render.
        if (!next) setCopied(false);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" data-testid="invite-member">
          <UserPlus className="size-4" />
          Invite
        </Button>
      </DialogTrigger>

      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation ready</DialogTitle>
              <DialogDescription>
                {created.email
                  ? `Only ${created.email} can use this link. Send it to them however you like.`
                  : "Anyone with this link can join. Share it with the people you want in."}
              </DialogDescription>
            </DialogHeader>

            {/* `min-w-0` is load-bearing: DialogContent is a grid, and a grid
                item's default `min-width: auto` lets the un-breakable invitation
                URL widen the whole column past the dialog — which drags the
                full-bleed footer out with it. */}
            <div className="flex w-full min-w-0 items-center gap-2">
              <div className="bg-muted flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2">
                <Link2 className="text-muted-foreground size-4 shrink-0" />
                <span className="truncate font-mono text-xs" data-testid="invite-link">
                  {created.url}
                </span>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyLink(created.url)}
                aria-label="Copy invitation link"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>

            <p className="text-muted-foreground text-xs">
              The link expires in 7 days and stops working once it has been used.
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction} noValidate>
            <DialogHeader>
              <DialogTitle>Invite someone</DialogTitle>
              <DialogDescription>
                You’ll get a link to send them. They join as soon as they open it.
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" name="householdId" value={householdId} />

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">
                  Their email <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="roommate@example.com"
                  autoComplete="off"
                  aria-invalid={emailErrors ? true : undefined}
                  aria-describedby={
                    emailErrors ? "invite-email-error" : "invite-email-hint"
                  }
                  disabled={isPending}
                  data-testid="invite-email"
                />
                {emailErrors ? (
                  <p
                    id="invite-email-error"
                    role="alert"
                    className="text-destructive text-sm"
                  >
                    {emailErrors[0]}
                  </p>
                ) : (
                  <p id="invite-email-hint" className="text-muted-foreground text-sm">
                    Add one to lock the invitation to that address. Leave it blank for a
                    link anyone can use.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-role">Join as</Label>
                <Select
                  name="role"
                  value={role}
                  onValueChange={(value) => setRole(value as "member" | "admin")}
                  disabled={isPending}
                >
                  <SelectTrigger id="invite-role" className="w-full">
                    {role === "admin" ? "Admin" : "Member"}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-sm">
                  {ROLE_DESCRIPTIONS[role]}.
                </p>
              </div>

              {formError ? (
                <p role="alert" className="text-destructive text-sm">
                  {formError}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Creating…
                  </>
                ) : (
                  "Create invitation"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
