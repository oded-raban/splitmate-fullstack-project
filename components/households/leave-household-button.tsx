"use client";

/**
 * Leave a household.
 *
 * The refusals this can produce — you own the place, or you have an unsettled
 * balance — are returned by the action as sentences, so they are shown as toasts
 * rather than being pre-empted by disabling the button. Disabling it would leave
 * the user staring at a control that does nothing and explains nothing.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { leaveHousehold } from "@/lib/actions/households";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";

interface LeaveHouseholdButtonProps {
  householdId: string;
  householdName: string;
}

export function LeaveHouseholdButton({
  householdId,
  householdName,
}: LeaveHouseholdButtonProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive" size="sm" data-testid="leave-household">
          <LogOut className="size-4" />
          Leave household
        </Button>
      }
      title={`Leave ${householdName}?`}
      description={
        <>
          <p>You lose access to its expenses, balances and shopping list.</p>
          <p>
            Everything you recorded stays — the household keeps its full history. You
            can only come back if someone invites you again.
          </p>
        </>
      }
      confirmLabel="Leave household"
      confirmPhrase={householdName}
      onConfirm={async () => {
        const formData = new FormData();
        formData.set("householdId", householdId);

        const result = await leaveHousehold(formData);
        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }

        toast.success(`You left ${householdName}`);
        // Navigating away is required, not cosmetic: the current route is inside
        // a household this user is no longer a member of, so re-rendering it
        // would now correctly 404.
        startTransition(() => router.push("/app"));
      }}
    />
  );
}
