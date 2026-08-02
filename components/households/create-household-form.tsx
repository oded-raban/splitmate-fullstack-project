"use client";

/**
 * Create-household form.
 * =============================================================================
 * One required field. Everything else a household needs — the owner membership,
 * eight starter categories, a shopping list — is created for it, because a new
 * user cannot yet tell which of those decisions matter and asking them to make
 * six choices before recording a single expense is how a first session ends
 * without one.
 *
 * The currency is chosen here and never again: it is the unit every stored
 * amount is denominated in, so changing it later would silently reinterpret
 * history rather than convert it.
 */

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import { createHousehold } from "@/lib/actions/households";
import type { ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

const initialState: ActionResult<{ householdId: string }> | undefined = undefined;

const CURRENCIES = [
  { code: "ILS", label: "₪ Israeli shekel" },
  { code: "EUR", label: "€ Euro" },
  { code: "USD", label: "$ US dollar" },
  { code: "GBP", label: "£ Pound sterling" },
] as const;

export function CreateHouseholdForm() {
  const [state, formAction, isPending] = useActionState(createHousehold, initialState);
  // Controlled, and the trigger renders the label itself rather than delegating
  // to <SelectValue>. Radix only learns an item's text once the dropdown has
  // been opened, so an uncontrolled select with a default value shows an empty
  // trigger until the user opens it — which reads as a broken form.
  const [currency, setCurrency] = useState<string>("ILS");

  const nameErrors =
    state?.ok === false ? state.error.fieldErrors?.["name"] : undefined;
  const formError =
    state?.ok === false && state.error.code !== "VALIDATION"
      ? state.error.message
      : undefined;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="name">Household name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Dizengoff 42"
          maxLength={80}
          required
          autoFocus
          autoComplete="off"
          aria-invalid={nameErrors ? true : undefined}
          aria-describedby={nameErrors ? "name-error" : "name-hint"}
          disabled={isPending}
          data-testid="household-name"
        />
        {nameErrors ? (
          <p id="name-error" role="alert" className="text-destructive text-sm">
            {nameErrors[0]}
          </p>
        ) : (
          <p id="name-hint" className="text-muted-foreground text-sm">
            Whatever your roommates call the place.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="currency">Currency</Label>
        <Select
          name="currency"
          value={currency}
          onValueChange={setCurrency}
          disabled={isPending}
        >
          <SelectTrigger
            id="currency"
            className="w-full"
            data-testid="household-currency"
          >
            {CURRENCIES.find((option) => option.code === currency)?.label}
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((currency) => (
              <SelectItem key={currency.code} value={currency.code}>
                {currency.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          Fixed once the household exists — every amount is stored in it.
        </p>
      </div>

      {formError ? (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Creating…
          </>
        ) : (
          "Create household"
        )}
      </Button>
    </form>
  );
}
