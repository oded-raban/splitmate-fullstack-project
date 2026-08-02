"use client";

/**
 * Cancels an outstanding invitation.
 *
 * No typed confirmation: cancelling a link is not destructive — nothing is lost
 * and a fresh invitation takes one click to create. Reserving the heavier
 * confirmation for actions that genuinely cannot be undone is what keeps it
 * meaningful when it does appear.
 */

import { useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { revokeInvitation } from "@/lib/actions/invitations";
import { Button } from "@/components/ui/button";

interface RevokeInvitationButtonProps {
  householdId: string;
  invitationId: string;
  label: string;
}

export function RevokeInvitationButton({
  householdId,
  invitationId,
  label,
}: RevokeInvitationButtonProps) {
  const [isPending, startTransition] = useTransition();

  function revoke() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("householdId", householdId);
      formData.set("invitationId", invitationId);

      const result = await revokeInvitation(formData);
      if (result.ok) toast.success("Invitation cancelled");
      else toast.error(result.error.message);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={revoke}
      disabled={isPending}
      aria-label={`Cancel invitation for ${label}`}
      data-testid={`revoke-${invitationId}`}
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <X className="size-4" />
      )}
    </Button>
  );
}
