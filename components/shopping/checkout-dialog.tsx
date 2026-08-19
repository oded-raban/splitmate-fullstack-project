"use client";

/**
 * Turns the ticked items into a shared expense.
 * =============================================================================
 * The step that closes the loop: without it somebody does the shopping, pays for
 * it, and the fact quietly stays theirs.
 *
 * Only three things are asked for — what it cost, who paid, and which category —
 * and only the first genuinely needs a human. The split is fixed at equal across
 * the whole household rather than offering the four methods the expense form
 * has, because this is a supermarket receipt at the end of a shop, and a screen
 * asking how to divide it is a screen people close.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { checkoutShoppingItems } from "@/lib/actions/shopping";
import type { CategoryOption } from "@/lib/data/expenses";
import type { MemberDetail } from "@/lib/data/households";
import { displayNameOf } from "@/lib/display";
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

interface CheckoutDialogProps {
  householdId: string;
  currency: string;
  itemIds: string[];
  members: MemberDetail[];
  categories: CategoryOption[];
  viewerId: string;
  today: string;
  trigger: React.ReactNode;
}

export function CheckoutDialog({
  householdId,
  currency,
  itemIds,
  members,
  categories,
  viewerId,
  today,
  trigger,
}: CheckoutDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [payerId, setPayerId] = useState(viewerId);
  const [categoryId, setCategoryId] = useState(
    () => categories.find((option) => option.name === "Groceries")?.id ?? "",
  );
  const [error, setError] = useState<ActionError | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await checkoutShoppingItems(undefined, formData);

      if (result.ok) {
        setError(null);
        setOpen(false);
        toast.success("Added to the ledger");
        router.push(`/app/households/${householdId}/expenses/${result.data.expenseId}`);
        return;
      }

      setError(result.error);
    });
  }

  const amountError = error?.fieldErrors?.["amount"]?.[0];
  const formError = error && error.code !== "VALIDATION" ? error.message : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>What did it come to?</DialogTitle>
          <DialogDescription>
            {itemIds.length} item{itemIds.length === 1 ? "" : "s"} will be cleared from
            the list and split equally across the household.
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="space-y-4" noValidate>
          <input type="hidden" name="householdId" value={householdId} />
          <input type="hidden" name="itemIds" value={JSON.stringify(itemIds)} />
          <input type="hidden" name="payerId" value={payerId} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="spentAt" value={today} />

          <div className="space-y-2">
            <Label htmlFor="checkout-amount">Total ({currency})</Label>
            <Input
              id="checkout-amount"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              autoFocus
              required
              aria-invalid={amountError ? true : undefined}
              disabled={isPending}
              data-testid="checkout-amount"
            />
            {amountError ? (
              <p role="alert" className="text-destructive text-sm">
                {amountError}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                What the till charged, not what the list estimated.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="checkout-payer">Who paid</Label>
            <Select value={payerId} onValueChange={setPayerId} disabled={isPending}>
              <SelectTrigger id="checkout-payer" className="w-full">
                {displayNameOf(
                  members.find((member) => member.userId === payerId) ?? {},
                  "Choose",
                )}
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {displayNameOf(member)}
                    {member.isViewer ? " (you)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="checkout-category">Category</Label>
            <Select
              value={categoryId || "none"}
              onValueChange={(value) => setCategoryId(value === "none" ? "" : value)}
              disabled={isPending}
            >
              <SelectTrigger id="checkout-category" className="w-full">
                {categories.find((option) => option.id === categoryId)?.name ??
                  "Uncategorised"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Uncategorised</SelectItem>
                {categories.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
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
            <Button type="submit" disabled={isPending} data-testid="checkout-submit">
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Adding…
                </>
              ) : (
                "Add expense"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
