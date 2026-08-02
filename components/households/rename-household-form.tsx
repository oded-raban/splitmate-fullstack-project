"use client";

/**
 * Rename a household.
 *
 * The currency is shown alongside but is not editable. Changing it would not
 * convert anything — every amount is stored as an integer in the household's
 * minor units — so a household that switched from shekels to euros would simply
 * relabel ₪1,200 of rent as €1,200. Fixing it at creation is the only reading
 * that stays honest.
 */

import { useActionState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateHousehold } from "@/lib/actions/households";
import { type ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionResult<{ name: string }> | undefined = undefined;

interface RenameHouseholdFormProps {
  householdId: string;
  name: string;
  currency: string;
}

export function RenameHouseholdForm({
  householdId,
  name,
  currency,
}: RenameHouseholdFormProps) {
  const [state, formAction, isPending] = useActionState(updateHousehold, initialState);

  const nameErrors =
    state?.ok === false ? state.error.fieldErrors?.["name"] : undefined;

  useEffect(() => {
    if (state?.ok && state.data) toast.success("Household renamed");
    else if (state?.ok === false && state.error.code !== "VALIDATION") {
      toast.error(state.error.message);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="householdId" value={householdId} />

      <div className="space-y-2">
        <Label htmlFor="household-name">Name</Label>
        <div className="flex gap-2">
          <Input
            id="household-name"
            name="name"
            defaultValue={name}
            maxLength={80}
            required
            aria-invalid={nameErrors ? true : undefined}
            aria-describedby={nameErrors ? "household-name-error" : undefined}
            disabled={isPending}
            data-testid="rename-household"
          />
          <Button type="submit" variant="outline" disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </div>
        {nameErrors ? (
          <p
            id="household-name-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {nameErrors[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="household-currency">Currency</Label>
        <Input id="household-currency" value={currency} disabled readOnly />
        <p className="text-muted-foreground text-sm">
          Set when the household was created and fixed afterwards — every amount already
          recorded is stored in it.
        </p>
      </div>
    </form>
  );
}
