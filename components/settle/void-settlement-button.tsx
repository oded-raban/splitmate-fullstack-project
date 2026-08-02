"use client";

/**
 * Withdraw a recorded payment.
 *
 * Voiding, not deleting. A settlement is one member's claim that they handed
 * money to another, and the other party may disagree. Removing the row would
 * make the balance change without evidence; marking it void leaves both the
 * claim and its withdrawal visible to everyone.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { voidSettlement } from "@/lib/actions/expenses";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

interface VoidSettlementButtonProps {
  householdId: string;
  settlementId: string;
}

export function VoidSettlementButton({
  householdId,
  settlementId,
}: VoidSettlementButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = () =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        const formData = new FormData();
        formData.set("householdId", householdId);
        formData.set("settlementId", settlementId);

        const result = await voidSettlement(undefined, formData);

        if (result.ok) {
          toast.success("Payment voided");
          router.refresh();
        } else {
          toast.error(result.error.message);
        }
        resolve();
      });
    });

  return (
    <ConfirmDialog
      title="Void this payment?"
      description="The balances go back to what they were before it was recorded, and both people will see the change. The entry stays in the history marked as voided."
      confirmLabel="Void payment"
      onConfirm={run}
      trigger={
        <Button variant="ghost" size="sm" disabled={isPending}>
          Void
        </Button>
      }
    />
  );
}
