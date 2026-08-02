"use client";

/**
 * Record a payment between two members.
 * =============================================================================
 * SplitMate does not move money and does not pretend to. This form records that
 * a real-world transfer happened — a bank transfer, a Bit payment, cash across
 * the kitchen table — and adjusts the balances accordingly.
 *
 * The amount is prefilled from the settlement plan, because the overwhelmingly
 * common case is "I paid exactly what the app told me to". It stays editable,
 * because partial repayment is normal and refusing it would push people to
 * record a payment they did not make.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { settleUp } from "@/lib/actions/expenses";
import type { MemberDetail } from "@/lib/data/households";
import { displayNameOf } from "@/lib/display";
import { formatForInput, type Minor } from "@/lib/domain/money";
import type { ActionError } from "@/lib/result";
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

const METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "bit", label: "Bit" },
  { value: "cash", label: "Cash" },
  { value: "paypal", label: "PayPal" },
  { value: "other", label: "Something else" },
] as const;

interface SettleUpFormProps {
  householdId: string;
  currency: string;
  members: MemberDetail[];
  fromUserId: string;
  toUserId: string;
  suggestedMinor: Minor;
  trigger: React.ReactNode;
}

export function SettleUpForm({
  householdId,
  currency,
  members,
  fromUserId,
  toUserId,
  suggestedMinor,
  trigger,
}: SettleUpFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(() => formatForInput(suggestedMinor));
  const [method, setMethod] = useState<string>("bank_transfer");

  const [error, setError] = useState<ActionError | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * Called instead of `useActionState` because this form lives in a dialog, and
   * the dialog has to close exactly when the write succeeds. Reacting to a
   * result in an effect would mean setting state during render-synchronisation,
   * which cascades renders; awaiting the action inside a transition puts the
   * decision in the one place that already knows the outcome.
   */
  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await settleUp(undefined, formData);

      if (result.ok) {
        setError(null);
        setOpen(false);
        toast.success("Payment recorded");
        // The balances, the plan and the activity feed all just changed. The
        // Server Action revalidated them; this pulls the fresh render in.
        router.refresh();
        return;
      }

      setError(result.error);
    });
  }

  const nameOf = (userId: string) => {
    const member = members.find((candidate) => candidate.userId === userId);
    return member ? displayNameOf(member) : "someone";
  };

  const amountError = error?.fieldErrors?.["amount"]?.[0];
  const formError = error && error.code !== "VALIDATION" ? error.message : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Re-arm from the plan each time it opens, so reopening after a partial
        // payment offers what is left rather than what was offered before.
        if (next) setAmount(formatForInput(suggestedMinor));
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            {nameOf(fromUserId)} paid {nameOf(toUserId)}. This records that the money
            already moved — SplitMate does not transfer it.
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="space-y-4" noValidate>
          <input type="hidden" name="householdId" value={householdId} />
          <input type="hidden" name="fromUserId" value={fromUserId} />
          <input type="hidden" name="toUserId" value={toUserId} />
          <input type="hidden" name="method" value={method} />

          <div className="space-y-2">
            <Label htmlFor="settle-amount">Amount ({currency})</Label>
            <Input
              id="settle-amount"
              name="amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              required
              aria-invalid={amountError ? true : undefined}
              disabled={isPending}
              data-testid="settle-amount"
            />
            {amountError ? (
              <p role="alert" className="text-destructive text-sm">
                {amountError}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                Change it if only part of the debt was paid.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="settle-method">How</Label>
            <Select value={method} onValueChange={setMethod} disabled={isPending}>
              <SelectTrigger id="settle-method" className="w-full">
                {METHODS.find((option) => option.value === method)?.label}
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {formError ? (
            <p role="alert" className="text-destructive text-sm">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={isPending} data-testid="settle-submit">
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Recording…
                </>
              ) : (
                "Record payment"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
