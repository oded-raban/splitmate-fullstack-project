/**
 * Recurring expenses.
 * =============================================================================
 * The rules that add expenses without anybody pressing a button. Because that is
 * exactly the kind of automation people stop trusting, this page is readable by
 * every member — not only the owners and admins who can change it — and shows
 * when each rule last fired and when it fires next. "Why is there rent on my
 * balance?" should be answerable here in one look.
 */

import { notFound } from "next/navigation";
import { Repeat } from "lucide-react";

import { requireMembership } from "@/lib/auth";
import { todayIn } from "@/lib/dates";
import { getCategories } from "@/lib/data/expenses";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { getRecurringRules } from "@/lib/data/recurring";
import { displayNameOf } from "@/lib/display";
import { formatMoney } from "@/lib/domain/money";
import { RECURRENCE_LABELS } from "@/lib/validation/recurring";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { RecurringForm } from "@/components/recurring/recurring-form";
import { RuleActions } from "@/components/recurring/rule-actions";

export const metadata = { title: "Recurring" };

const formatDate = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export default async function RecurringPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const { user, role } = await requireMembership(householdId);

  const [household, rules, categories] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getRecurringRules(householdId),
    getCategories(householdId),
  ]);

  if (!household) notFound();

  // Mirrors `recurring_insert` / `recurring_update` / `recurring_delete`. The
  // database is what enforces it; this only decides whether to offer the button.
  const canManage = role === "owner" || role === "admin";

  const nameOf = (userId: string) => {
    const member = household.members.find((candidate) => candidate.userId === userId);
    return member ? displayNameOf(member) : "A former member";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Recurring expenses</h2>
          <p className="text-muted-foreground text-sm">
            Added automatically, split equally across whoever is in the household on the
            day.
          </p>
        </div>

        {canManage ? (
          <RecurringForm
            householdId={householdId}
            currency={household.currency}
            members={household.members}
            categories={categories}
            viewerId={user.id}
            today={todayIn(household.timezone)}
          />
        ) : null}
      </div>

      {rules.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No recurring expenses yet"
          description={
            canManage
              ? "Set up rent or a subscription once, and it will be added and split on schedule without anyone having to remember."
              : "An owner or admin can set up rent and subscriptions so they are added automatically."
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {rules.filter((rule) => rule.isActive).length} active
            </CardTitle>
          </CardHeader>

          <CardContent>
            <ul className="divide-border divide-y">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
                  data-testid="recurring-rule"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {rule.description}
                      {!rule.isActive ? <Badge variant="outline">Paused</Badge> : null}
                      {rule.categoryName ? (
                        <Badge variant="secondary">{rule.categoryName}</Badge>
                      ) : null}
                    </p>

                    <p className="text-muted-foreground text-sm">
                      {RECURRENCE_LABELS[rule.frequency]}, paid by{" "}
                      {nameOf(rule.payerId)}
                    </p>

                    <p className="text-muted-foreground text-xs">
                      {rule.isActive
                        ? `Next on ${formatDate(rule.nextRunAt)}`
                        : "Paused — nothing will be added"}
                      {rule.lastRunAt
                        ? ` · last added ${formatDate(rule.lastRunAt)}`
                        : " · never added yet"}
                    </p>
                  </div>

                  <span className="text-sm font-medium tabular-nums">
                    {formatMoney(rule.amountMinor, household.currency)}
                  </span>

                  {canManage ? (
                    <RuleActions
                      householdId={householdId}
                      ruleId={rule.id}
                      description={rule.description}
                      isActive={rule.isActive}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
