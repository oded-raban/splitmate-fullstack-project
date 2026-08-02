"use client";

/**
 * Create / edit an expense.
 * =============================================================================
 * THE IMPORTANT THING ABOUT THIS FILE
 * The live preview below is computed by `computeSplits` — the same function the
 * Server Action calls to produce the shares it actually stores. Not a
 * reimplementation of it, and not an approximation: the identical module.
 *
 * That is possible because lib/domain is pure TypeScript with no framework or
 * database imports (an ESLint rule enforces it), so it runs unchanged in the
 * browser and on the server. The consequence is that the number a user sees
 * before pressing Save cannot disagree with the number that gets written — the
 * classic rounding complaint, where the preview says 95.82 and the ledger says
 * 95.81, is structurally impossible here.
 *
 * The preview is a convenience, never a decision. The form submits the raw
 * inputs and the method; the server recomputes from those. If it submitted the
 * computed shares instead, a modified request could assign its sender a share of
 * zero and everyone else the difference, and the total would still balance.
 *
 * WHY THE PARTICIPANT LIST IS ONE JSON FIELD
 * A split is a variable-length list of pairs. FormData's repeated-key encoding
 * would make the server reassemble that ordering by hand; one JSON field parsed
 * by a Zod schema is both simpler and stricter.
 */

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createExpense, updateExpense } from "@/lib/actions/expenses";
import {
  formatForInput,
  formatMoney,
  parseAmount,
  type Minor,
} from "@/lib/domain/money";
import {
  computeSplits,
  percentageTotal,
  remainderSeed,
  remainingToAssign,
  type ParticipantInput,
  type SplitMethod,
} from "@/lib/domain/splits";
import { displayNameOf, initialsOf } from "@/lib/display";
import type { CategoryOption, ExpenseDetail } from "@/lib/data/expenses";
import type { MemberDetail } from "@/lib/data/households";
import type { ActionResult } from "@/lib/result";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const SPLIT_METHODS: { value: SplitMethod; label: string; hint: string }[] = [
  { value: "equal", label: "Equally", hint: "Everyone selected pays the same" },
  { value: "exact", label: "Exact", hint: "Type each person's amount" },
  { value: "percentage", label: "Percent", hint: "Type each person's percentage" },
  { value: "shares", label: "Shares", hint: "Weights, e.g. 2 for a double room" },
];

interface ExpenseFormProps {
  householdId: string;
  currency: string;
  members: MemberDetail[];
  categories: CategoryOption[];
  viewerId: string;
  /**
   * Today's date in the household's timezone, resolved on the server.
   *
   * Not computed here from `new Date()`, for two reasons. The server and the
   * browser would produce different strings either side of midnight, which is a
   * hydration mismatch. And a household in Tel Aviv whose member is travelling
   * should still file an expense against the household's day, not the day where
   * the phone happens to be.
   */
  today: string;
  /** Present when editing; absent when creating. */
  expense?: ExpenseDetail;
}

export function ExpenseForm({
  householdId,
  currency,
  members,
  categories,
  viewerId,
  today,
  expense,
}: ExpenseFormProps) {
  const isEditing = expense !== undefined;
  const router = useRouter();

  const [state, formAction, isPending] = useActionState<
    ActionResult<{ expenseId: string }> | undefined,
    FormData
  >(isEditing ? updateExpense : createExpense, undefined);

  /**
   * Generated on first submit, not during render, and reused unchanged on every
   * retry. A double-click or a resubmission after a dropped connection therefore
   * resolves to the expense that already exists rather than creating a second
   * identical one.
   *
   * A ref rather than state, and populated at submit rather than at render,
   * because `crypto.randomUUID()` returns a different value on the server than
   * in the browser. Calling it during render puts one UUID in the server's HTML
   * and a different one in the client's first render, which is a hydration
   * mismatch. Submitting only ever happens on the client, so generating it there
   * sidesteps the problem entirely.
   */
  const idempotencyRef = useRef<string | null>(null);

  const [amountText, setAmountText] = useState(
    expense ? formatForInput(expense.amountMinor) : "",
  );
  const [method, setMethod] = useState<SplitMethod>(expense?.splitMethod ?? "equal");
  const [payerId, setPayerId] = useState(expense?.payerId ?? viewerId);
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");

  const [selected, setSelected] = useState<Set<string>>(() => {
    if (expense) return new Set(expense.splits.map((split) => split.userId));
    // Everyone by default: the overwhelmingly common case is a shared cost, and
    // starting from an empty list means the fastest path through this form has
    // an extra N taps in it.
    return new Set(members.map((member) => member.userId));
  });

  /** Raw text per participant. Meaning depends on the method. */
  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    if (!expense) return {};
    const seedInputs: Record<string, string> = {};
    for (const split of expense.splits) {
      if (split.shareInput !== null) {
        seedInputs[split.userId] =
          expense.splitMethod === "exact"
            ? formatForInput(split.shareMinor)
            : String(split.shareInput);
      }
    }
    return seedInputs;
  });

  const parsedAmount = parseAmount(amountText);
  const totalMinor: Minor | null = parsedAmount.ok ? parsedAmount.value : null;

  /**
   * Decides which participants absorb an indivisible remainder — the odd agora
   * when a total does not divide evenly.
   *
   * Derived from the amount, and from nothing else, so that the allocation is a
   * pure function of (amount, method, participants). Two consequences follow,
   * and both are the point:
   *
   * The Server Action can recompute this exact value from the fields it was
   * sent, so the preview and the stored split cannot disagree.
   *
   * Creating and editing agree too. Seeding the edit form with the expense id
   * instead — which is the obvious thing to reach for — would make opening an
   * unchanged expense show a different allocation than the one on file, and
   * saving it would shuffle the odd agora between roommates for no reason.
   */
  const seed = remainderSeed(totalMinor ?? 0);

  /**
   * Participants in the shape the domain expects.
   *
   * `exact` is the one method whose input is in MINOR units — the domain
   * contract says so, because a share is money and money is never a decimal in
   * this codebase. The other methods take a plain number: a percentage or a
   * weight, neither of which is currency.
   */
  const participants: ParticipantInput[] = useMemo(() => {
    return members
      .filter((member) => selected.has(member.userId))
      .map((member) => {
        const raw = inputs[member.userId] ?? "";
        if (method === "equal") return { userId: member.userId };

        if (method === "exact") {
          const parsed = parseAmount(raw, true);
          return {
            userId: member.userId,
            ...(parsed.ok ? { input: parsed.value as number } : {}),
          };
        }

        const numeric = Number(raw);
        return {
          userId: member.userId,
          ...(raw.trim() !== "" && Number.isFinite(numeric) ? { input: numeric } : {}),
        };
      });
  }, [members, selected, inputs, method]);

  const preview = useMemo(() => {
    if (totalMinor === null) return null;
    return computeSplits({ totalMinor, method, participants, seed });
  }, [totalMinor, method, participants, seed]);

  const shareOf = (userId: string): Minor | null => {
    if (!preview?.ok) return null;
    return preview.splits.find((split) => split.userId === userId)?.shareMinor ?? null;
  };

  /** A running total for the methods where the user has to make things add up. */
  const runningHint = useMemo(() => {
    if (method === "exact" && totalMinor !== null) {
      const entered = participants.map((p) => p.input ?? 0);
      const left = remainingToAssign(totalMinor, entered);
      if (left === 0) return null;
      return left > 0
        ? `${formatMoney(left as Minor, currency)} left to assign`
        : `${formatMoney(Math.abs(left) as Minor, currency)} over`;
    }

    if (method === "percentage") {
      const total = percentageTotal(participants.map((p) => p.input ?? 0));
      if (total === 100) return null;
      return `${total}% assigned — needs to be 100%`;
    }

    return null;
  }, [method, participants, totalMinor, currency]);

  const fieldError = (field: string) =>
    state?.ok === false ? state.error.fieldErrors?.[field]?.[0] : undefined;

  const formError =
    state?.ok === false && state.error.code !== "VALIDATION"
      ? state.error.message
      : undefined;

  // A successful save has nothing left to render, so it navigates. In an effect
  // rather than during render, because navigating and raising a toast are side
  // effects and React may render a component more than once per commit — doing
  // it inline would fire the toast twice.
  //
  // Navigation lives here rather than in the Server Action because the action is
  // reached from more than one place, and the right destination depends on where
  // the user started, which only the client knows.
  useEffect(() => {
    if (state?.ok !== true) return;
    toast.success(isEditing ? "Expense updated" : "Expense added");
    router.push(`/app/households/${householdId}/expenses`);
  }, [state, isEditing, router, householdId]);

  const toggle = (userId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  /**
   * Attaches the idempotency key before handing the form to the Server Action.
   * Wrapping rather than rendering a hidden input keeps a client-only value out
   * of the server-rendered HTML.
   */
  function submit(formData: FormData) {
    if (!isEditing) {
      idempotencyRef.current ??= crypto.randomUUID();
      formData.set("idempotencyKey", idempotencyRef.current);
    }
    formAction(formData);
  }

  return (
    <form action={submit} className="space-y-6" noValidate>
      <input type="hidden" name="householdId" value={householdId} />
      <input type="hidden" name="splitMethod" value={method} />
      <input type="hidden" name="payerId" value={payerId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <input
        type="hidden"
        name="participants"
        value={JSON.stringify(
          participants.map((participant) =>
            participant.input === undefined
              ? { userId: participant.userId }
              : { userId: participant.userId, input: participant.input },
          ),
        )}
      />
      {isEditing ? (
        <>
          <input type="hidden" name="expenseId" value={expense.id} />
          <input type="hidden" name="expectedUpdatedAt" value={expense.updatedAt} />
        </>
      ) : null}

      {/* --- What and how much ------------------------------------------- */}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="description">What was it?</Label>
          <Input
            id="description"
            name="description"
            defaultValue={expense?.description ?? ""}
            placeholder="Weekly groceries"
            maxLength={120}
            required
            autoFocus={!isEditing}
            autoComplete="off"
            aria-invalid={fieldError("description") ? true : undefined}
            disabled={isPending}
            data-testid="expense-description"
          />
          {fieldError("description") ? (
            <p role="alert" className="text-destructive text-sm">
              {fieldError("description")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            name="amount"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            placeholder="0.00"
            // `inputMode` rather than `type="number"`: a numeric keypad on
            // mobile, without the spinner, the scroll-wheel hazard, or the
            // locale-dependent parsing that a number input imposes.
            inputMode="decimal"
            autoComplete="off"
            required
            aria-invalid={fieldError("amount") ? true : undefined}
            disabled={isPending}
            data-testid="expense-amount"
          />
          {fieldError("amount") ? (
            <p role="alert" className="text-destructive text-sm">
              {fieldError("amount")}
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">In {currency}.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="spentAt">When</Label>
          <Input
            id="spentAt"
            name="spentAt"
            type="date"
            defaultValue={expense?.spentAt ?? today}
            required
            disabled={isPending}
            data-testid="expense-date"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="payer">Who paid</Label>
          <Select value={payerId} onValueChange={setPayerId} disabled={isPending}>
            <SelectTrigger id="payer" className="w-full" data-testid="expense-payer">
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
          <Label htmlFor="category">Category</Label>
          <Select
            value={categoryId || "none"}
            onValueChange={(value) => setCategoryId(value === "none" ? "" : value)}
            disabled={isPending}
          >
            <SelectTrigger id="category" className="w-full">
              {categories.find((option) => option.id === categoryId)?.name ??
                "Uncategorised"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Uncategorised</SelectItem>
              {categories.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.icon ? `${option.icon} ` : ""}
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* --- How it splits ------------------------------------------------ */}

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>Split</Label>
          {runningHint ? (
            <span className="text-muted-foreground text-sm">{runningHint}</span>
          ) : null}
        </div>

        <Tabs value={method} onValueChange={(value) => setMethod(value as SplitMethod)}>
          <TabsList className="grid w-full grid-cols-4">
            {SPLIT_METHODS.map((option) => (
              <TabsTrigger
                key={option.value}
                value={option.value}
                disabled={isPending}
                data-testid={`split-${option.value}`}
              >
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <p className="text-muted-foreground text-sm">
          {SPLIT_METHODS.find((option) => option.value === method)?.hint}
        </p>

        <ul className="divide-border divide-y rounded-md border">
          {members.map((member) => {
            const isIn = selected.has(member.userId);
            const share = shareOf(member.userId);

            return (
              <li key={member.userId} className="flex items-center gap-3 px-3 py-2.5">
                <Checkbox
                  checked={isIn}
                  onCheckedChange={() => toggle(member.userId)}
                  disabled={isPending}
                  aria-label={`Include ${displayNameOf(member)}`}
                  data-testid={`participant-${member.userId}`}
                />

                <Avatar className="size-7">
                  {member.avatarUrl ? (
                    <AvatarImage src={member.avatarUrl} alt="" />
                  ) : null}
                  <AvatarFallback className="text-[10px]">
                    {initialsOf(member)}
                  </AvatarFallback>
                </Avatar>

                <span className="min-w-0 flex-1 truncate text-sm">
                  {displayNameOf(member)}
                  {member.isViewer ? (
                    <span className="text-muted-foreground"> (you)</span>
                  ) : null}
                </span>

                {isIn && method !== "equal" ? (
                  <Input
                    value={inputs[member.userId] ?? ""}
                    onChange={(event) =>
                      setInputs((current) => ({
                        ...current,
                        [member.userId]: event.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder={method === "shares" ? "1" : "0"}
                    className="w-24 text-right"
                    disabled={isPending}
                    aria-label={`${displayNameOf(member)}'s ${method} value`}
                    data-testid={`input-${member.userId}`}
                  />
                ) : null}

                <span
                  className={
                    isIn
                      ? "w-24 text-right text-sm font-medium tabular-nums"
                      : "text-muted-foreground w-24 text-right text-sm tabular-nums"
                  }
                  data-testid={`share-${member.userId}`}
                >
                  {isIn && share !== null ? formatMoney(share, currency) : "—"}
                </span>
              </li>
            );
          })}
        </ul>

        {preview && !preview.ok ? (
          <p role="alert" className="text-destructive text-sm">
            {preview.message}
          </p>
        ) : null}
        {fieldError("participants") ? (
          <p role="alert" className="text-destructive text-sm">
            {fieldError("participants")}
          </p>
        ) : null}
      </div>

      {/* --- Anything else ------------------------------------------------ */}

      <div className="space-y-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea
          id="note"
          name="note"
          defaultValue={expense?.note ?? ""}
          rows={2}
          maxLength={500}
          placeholder="Anything the others should know"
          disabled={isPending}
        />
      </div>

      {formError ? (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={isPending || (preview !== null && !preview.ok)}
          data-testid="expense-submit"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : isEditing ? (
            "Save changes"
          ) : (
            "Add expense"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
