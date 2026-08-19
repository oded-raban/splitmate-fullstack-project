"use client";

/**
 * Creates a recurring rule.
 * =============================================================================
 * The one screen in the app where the user is describing the future rather than
 * recording the past, so it works harder than the expense form at showing what
 * it understood: the summary line at the bottom restates the whole rule as a
 * sentence, because "monthly, day 1" is a thing people misread and "Every month
 * on the 1st, starting 1 September" is not.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createRecurringRule } from "@/lib/actions/recurring";
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

const FREQUENCIES = [
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "yearly", label: "Every year" },
] as const;

const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
];

/** "1st", "2nd", "3rd", "11th"… — the teens are the reason this is not a lookup. */
function ordinal(day: number): string {
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : ["th", "st", "nd", "rd"][day % 10] || "th";

  return `${day}${suffix}`;
}

interface RecurringFormProps {
  householdId: string;
  currency: string;
  members: MemberDetail[];
  categories: CategoryOption[];
  viewerId: string;
  today: string;
}

export function RecurringForm({
  householdId,
  currency,
  members,
  categories,
  viewerId,
  today,
}: RecurringFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<"weekly" | "monthly" | "yearly">(
    "monthly",
  );
  const [dayOfPeriod, setDayOfPeriod] = useState("1");
  const [payerId, setPayerId] = useState(viewerId);
  const [categoryId, setCategoryId] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [error, setError] = useState<ActionError | null>(null);
  const [isPending, startTransition] = useTransition();

  // Switching to weekly with "the 15th" selected would submit a day the schema
  // rejects. Corrected on change rather than on submit, so the control never
  // shows a value that is about to be refused.
  function handleFrequencyChange(value: string) {
    const next = value as "weekly" | "monthly" | "yearly";
    setFrequency(next);
    if (next === "weekly" && Number(dayOfPeriod) > 7) setDayOfPeriod("1");
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createRecurringRule(undefined, formData);

      if (result.ok) {
        setError(null);
        setOpen(false);
        toast.success("Rule saved");
        router.refresh();
        return;
      }

      setError(result.error);
    });
  }

  const fieldError = (field: string) => error?.fieldErrors?.[field]?.[0];
  const formError = error && error.code !== "VALIDATION" ? error.message : undefined;

  const summary =
    frequency === "weekly"
      ? `Every ${WEEKDAYS.find((day) => day.value === dayOfPeriod)?.label ?? "week"}`
      : frequency === "monthly"
        ? `Every month on the ${ordinal(Number(dayOfPeriod) || 1)}`
        : `Every year on the ${ordinal(Number(dayOfPeriod) || 1)} of that month`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="recurring-new">
          <Plus className="size-4" />
          New rule
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set up a recurring expense</DialogTitle>
          <DialogDescription>
            Rent, utilities, a subscription — anything that arrives on a schedule.
            SplitMate will add it for you and split it equally.
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="space-y-4" noValidate>
          <input type="hidden" name="householdId" value={householdId} />
          <input type="hidden" name="payerId" value={payerId} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="frequency" value={frequency} />
          <input type="hidden" name="dayOfPeriod" value={dayOfPeriod} />

          <div className="space-y-2">
            <Label htmlFor="rule-description">What is it</Label>
            <Input
              id="rule-description"
              name="description"
              placeholder="Rent"
              maxLength={120}
              autoComplete="off"
              required
              disabled={isPending}
              aria-invalid={fieldError("description") ? true : undefined}
              data-testid="rule-description"
            />
            {fieldError("description") ? (
              <p role="alert" className="text-destructive text-sm">
                {fieldError("description")}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-amount">Amount ({currency})</Label>
            <Input
              id="rule-amount"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              required
              disabled={isPending}
              aria-invalid={fieldError("amount") ? true : undefined}
              data-testid="rule-amount"
            />
            {fieldError("amount") ? (
              <p role="alert" className="text-destructive text-sm">
                {fieldError("amount")}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rule-frequency">How often</Label>
              <Select
                value={frequency}
                onValueChange={handleFrequencyChange}
                disabled={isPending}
              >
                <SelectTrigger id="rule-frequency" className="w-full">
                  {FREQUENCIES.find((option) => option.value === frequency)?.label}
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-day">
                {frequency === "weekly" ? "On" : "Day of the month"}
              </Label>

              {frequency === "weekly" ? (
                <Select
                  value={dayOfPeriod}
                  onValueChange={setDayOfPeriod}
                  disabled={isPending}
                >
                  <SelectTrigger id="rule-day" className="w-full">
                    {WEEKDAYS.find((day) => day.value === dayOfPeriod)?.label}
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((day) => (
                      <SelectItem key={day.value} value={day.value}>
                        {day.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="rule-day"
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfPeriod}
                  onChange={(event) => setDayOfPeriod(event.target.value)}
                  disabled={isPending}
                  aria-invalid={fieldError("dayOfPeriod") ? true : undefined}
                />
              )}

              {fieldError("dayOfPeriod") ? (
                <p role="alert" className="text-destructive text-sm">
                  {fieldError("dayOfPeriod")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rule-payer">Who pays it</Label>
              <Select value={payerId} onValueChange={setPayerId} disabled={isPending}>
                <SelectTrigger id="rule-payer" className="w-full">
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
              <Label htmlFor="rule-category">Category</Label>
              <Select
                value={categoryId || "none"}
                onValueChange={(value) => setCategoryId(value === "none" ? "" : value)}
                disabled={isPending}
              >
                <SelectTrigger id="rule-category" className="w-full">
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-starts">Starting from</Label>
            <Input
              id="rule-starts"
              name="startsOn"
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
              required
              disabled={isPending}
              aria-invalid={fieldError("startsOn") ? true : undefined}
            />
            {fieldError("startsOn") ? (
              <p role="alert" className="text-destructive text-sm">
                {fieldError("startsOn")}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                {summary}. The first one is added on or after this date — never
                backdated.
              </p>
            )}
          </div>

          {formError ? (
            <p role="alert" className="text-destructive text-sm">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={isPending} data-testid="rule-submit">
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                "Save rule"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
