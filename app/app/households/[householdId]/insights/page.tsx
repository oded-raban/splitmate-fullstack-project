/**
 * Insights.
 * =============================================================================
 * Answers "where is the money going?" — the question that turns a ledger into
 * something worth keeping. The balances page says what you owe today; this says
 * whether the household's spending is drifting, and on what.
 *
 * The window lives in the URL rather than in component state, so a particular
 * view is a link somebody can send to a flatmate mid-argument, and so the whole
 * page can stay a Server Component.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartColumn } from "lucide-react";

import { requireMembership } from "@/lib/auth";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { getInsights } from "@/lib/data/insights";
import { displayNameOf } from "@/lib/display";
import { asMinor, formatMoney } from "@/lib/domain/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { SpendingCharts } from "@/components/insights/spending-charts";
import { ExportButton } from "@/components/insights/export-button";

export const metadata = { title: "Insights" };

/** Selectable windows, in months back from today. */
const RANGES = [
  { key: "3m", label: "3 months", months: 3 },
  { key: "6m", label: "6 months", months: 6 },
  { key: "12m", label: "12 months", months: 12 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

/**
 * Resolves a range key into a date window.
 *
 * Anchored to the first of the month rather than to "today minus 90 days", so
 * the leftmost bar is a whole month like every other bar. A partial first month
 * reads as a spending drop that never happened.
 */
function windowFor(key: RangeKey): { from: string; to: string } {
  const range = RANGES.find((candidate) => candidate.key === key) ?? RANGES[1];
  const now = new Date();

  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (range.months - 1), 1),
  );
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ householdId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { householdId } = await params;
  await requireMembership(householdId);

  const { range } = await searchParams;
  const activeRange: RangeKey = RANGES.some((candidate) => candidate.key === range)
    ? (range as RangeKey)
    : "6m";

  const { from, to } = windowFor(activeRange);

  const [household, insights] = await Promise.all([
    getHouseholdWithMembers(householdId),
    getInsights(householdId, from, to),
  ]);

  if (!household || !insights) notFound();

  const nameOf = (userId: string) => {
    const member = household.members.find((candidate) => candidate.userId === userId);
    return member ? displayNameOf(member) : "A former member";
  };

  const hasSpending = insights.totalMinor > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Date range" className="flex gap-1">
          {RANGES.map((option) => {
            const isActive = option.key === activeRange;

            return (
              <Link
                key={option.key}
                href={`/app/households/${householdId}/insights?range=${option.key}`}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>

        <ExportButton householdId={householdId} from={from} to={to} />
      </div>

      {!hasSpending ? (
        <EmptyState
          icon={ChartColumn}
          title="Nothing to chart yet"
          description="Once the household has logged a few expenses, this page will show where the money is going and who has been carrying it."
          action={
            <Button asChild size="sm">
              <Link href={`/app/households/${householdId}/expenses/new`}>
                Add an expense
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {formatMoney(insights.totalMinor, household.currency)}
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                spent across{" "}
                {insights.months.length === 1
                  ? "1 month"
                  : `${insights.months.length} months`}
              </p>
            </CardHeader>

            <CardContent>
              <SpendingCharts
                months={insights.months}
                categories={insights.categories}
                currency={household.currency}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Who paid, and who used it</CardTitle>
              <p className="text-muted-foreground text-sm">
                Paying more than you consume is what a positive balance is made
                of&nbsp;— this shows where that came from over the period, rather than
                only where it stands now.
              </p>
            </CardHeader>

            <CardContent>
              <ul className="divide-border divide-y">
                {insights.members.map((member) => {
                  const difference = member.paidMinor - member.consumedMinor;

                  return (
                    <li
                      key={member.userId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {nameOf(member.userId)}
                      </span>

                      <span className="text-muted-foreground text-sm">
                        paid{" "}
                        <span className="text-foreground font-medium tabular-nums">
                          {formatMoney(member.paidMinor, household.currency)}
                        </span>
                      </span>

                      <span className="text-muted-foreground text-sm">
                        used{" "}
                        <span className="text-foreground font-medium tabular-nums">
                          {formatMoney(member.consumedMinor, household.currency)}
                        </span>
                      </span>

                      {difference !== 0 ? (
                        <Badge variant={difference > 0 ? "secondary" : "outline"}>
                          {difference > 0 ? "+" : "−"}
                          {formatMoney(
                            asMinor(Math.abs(difference)),
                            household.currency,
                          )}
                        </Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
