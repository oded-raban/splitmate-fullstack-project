"use client";

/**
 * The two charts on the insights page.
 * =============================================================================
 * A Client Component only because Recharts measures the DOM to lay itself out.
 * Everything it draws was aggregated in Postgres and is already reduced to a few
 * dozen numbers by the time it reaches the browser.
 *
 * Both charts answer a question somebody actually asks. The bars answer "are we
 * spending more than we used to?", which needs a time axis. The pie answers
 * "what is the money going on?", which needs proportion. A single chart cannot
 * do both, and picking one would leave half the question unanswered.
 */

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CategoryTotal, MonthTotal } from "@/lib/data/insights";
import { formatAmount, formatMoney, type Minor } from "@/lib/domain/money";

/**
 * Chart colours, taken from the design tokens rather than invented here.
 *
 * Ordered so that adjacent slices differ in lightness as well as hue, which is
 * what keeps them distinguishable to a red-green colour-blind reader — roughly
 * one man in twelve — and in a black-and-white printout.
 */
const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

interface SpendingChartsProps {
  months: MonthTotal[];
  categories: CategoryTotal[];
  currency: string;
}

export function SpendingCharts({ months, categories, currency }: SpendingChartsProps) {
  const monthData = months.map((month) => ({
    label: new Date(`${month.month}T00:00:00Z`).toLocaleDateString("en-GB", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    }),
    // Recharts needs a plain number for the axis, so minor units are converted
    // to major here. This is the one place that is legitimate: it feeds a pixel
    // height, never a stored value or anything a person is asked to agree with.
    value: month.totalMinor / 100,
    minor: month.totalMinor,
  }));

  // Long tails make an unreadable pie. The five largest are named and the rest
  // are honestly labelled rather than dropped, so the slices still sum to the
  // total shown above them.
  const top = categories.slice(0, 5);
  const rest = categories.slice(5);
  const restTotal = rest.reduce((sum, category) => sum + category.totalMinor, 0);

  const pieData = [
    ...top.map((category) => ({
      name: category.categoryName,
      value: category.totalMinor / 100,
      minor: category.totalMinor,
    })),
    ...(rest.length
      ? [
          {
            name: `${rest.length} more`,
            value: restTotal / 100,
            minor: restTotal as Minor,
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="chart-months" className="space-y-2">
        <h3 id="chart-months" className="text-sm font-medium">
          Spending by month
        </h3>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={monthData}
              margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            >
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                fontSize={12}
                stroke="var(--muted-foreground)"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={12}
                width={48}
                stroke="var(--muted-foreground)"
                tickFormatter={(value: number) => formatAmount((value * 100) as Minor)}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  fontSize: "0.875rem",
                }}
                formatter={(_value, _name, entry) => [
                  formatMoney((entry.payload as { minor: Minor }).minor, currency),
                  "Total",
                ]}
              />
              <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section aria-labelledby="chart-categories" className="space-y-2">
        <h3 id="chart-categories" className="text-sm font-medium">
          Where it went
        </h3>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
              >
                {pieData.map((slice, index) => (
                  <Cell key={slice.name} fill={PALETTE[index % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  fontSize: "0.875rem",
                }}
                formatter={(_value, name, entry) => [
                  formatMoney((entry.payload as { minor: Minor }).minor, currency),
                  name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/*
          A rendered legend rather than Recharts' own, so the colour is not the
          only thing carrying the label — the swatch sits next to the name and
          the amount, which is what makes the chart usable without colour vision.
        */}
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          {pieData.map((slice, index) => (
            <li key={slice.name} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: PALETTE[index % PALETTE.length] }}
              />
              <span className="min-w-0 flex-1 truncate">{slice.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatMoney(slice.minor, currency)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
