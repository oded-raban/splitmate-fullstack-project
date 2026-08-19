"use client";

/**
 * Pause, resume and delete for one recurring rule.
 * =============================================================================
 * Split out as the only interactive part of the rules page, so the list itself
 * stays a Server Component and the JavaScript cost scales with the number of
 * controls rather than with the amount of text on the page.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteRecurringRule, toggleRecurringRule } from "@/lib/actions/recurring";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

interface RuleActionsProps {
  householdId: string;
  ruleId: string;
  description: string;
  isActive: boolean;
}

export function RuleActions({
  householdId,
  ruleId,
  description,
  isActive,
}: RuleActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleRecurringRule({
        householdId,
        ruleId,
        isActive: !isActive,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(isActive ? "Rule paused" : "Rule resumed");
      router.refresh();
    });
  }

  async function handleDelete() {
    const result = await deleteRecurringRule({ householdId, ruleId });

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success("Rule deleted");
    router.refresh();
  }

  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={handleToggle}
        disabled={isPending}
        aria-label={isActive ? `Pause ${description}` : `Resume ${description}`}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isActive ? (
          <Pause className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
      </Button>

      <ConfirmDialog
        title={`Delete "${description}"?`}
        description="It will stop being added from now on. Expenses it has already created stay in the ledger, so nobody's balance changes."
        confirmLabel="Delete rule"
        onConfirm={handleDelete}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Delete ${description}`}
          >
            <Trash2 className="size-4" />
          </Button>
        }
      />
    </div>
  );
}
