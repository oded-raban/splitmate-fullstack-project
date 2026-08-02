"use client";

/**
 * Remove an expense from the ledger.
 *
 * Confirmation is required because the effect is not local: deleting an expense
 * changes what every other member of the household owes, and they will see it
 * happen. The wording says so rather than asking a generic "are you sure?".
 *
 * The delete is a soft one — the row stays, flagged — so the confirmation
 * deliberately does not promise erasure.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteExpense } from "@/lib/actions/expenses";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

interface DeleteExpenseButtonProps {
  householdId: string;
  expenseId: string;
}

export function DeleteExpenseButton({
  householdId,
  expenseId,
}: DeleteExpenseButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const remove = () =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        const formData = new FormData();
        formData.set("householdId", householdId);
        formData.set("expenseId", expenseId);

        const result = await deleteExpense(undefined, formData);

        if (result.ok) {
          toast.success("Expense deleted");
          router.push(`/app/households/${householdId}/expenses`);
        } else {
          toast.error(result.error.message);
        }
        resolve();
      });
    });

  return (
    <ConfirmDialog
      title="Delete this expense?"
      description="Everyone's balance will change, and the other members will see the update. The expense stays in the household's history as a deleted entry."
      confirmLabel="Delete expense"
      onConfirm={remove}
      trigger={
        <Button variant="outline" size="sm" disabled={isPending}>
          <Trash2 className="size-4" />
          Delete
        </Button>
      }
    />
  );
}
