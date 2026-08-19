/**
 * Pure scheduling logic for recurring expense rules.
 * =============================================================================
 * No framework, database or UI imports — enforced by the same ESLint boundary
 * that keeps `money.ts` and `splits.ts` pure, and for the same reason: date
 * arithmetic that decides when real money moves deserves to be exhaustively
 * unit-tested without a browser, a server, or a database in the loop.
 */

export type RecurrenceFrequency = "weekly" | "monthly" | "yearly";

/**
 * Resolves the first date a rule should fire, on or after `startsOn`.
 *
 * Computed forward rather than simply returning `startsOn`: a rule created on
 * the 20th saying "monthly on the 1st" must not immediately fire for the 1st
 * that has already passed and conjure a backdated expense nobody agreed to.
 *
 * The hard case is a monthly or yearly rule anchored to a day that a given
 * month does not have — "the 31st" in April, or "the 29th" of February in a
 * non-leap year. This clamps to the month's actual last day rather than
 * rolling into the next month, which is what a naive `setUTCDate(31)` would
 * do: silently turning "the 31st" into "the 1st of the month after."
 *
 * All arithmetic is done in UTC. `startsOn` is a plain `YYYY-MM-DD` with no
 * timezone of its own, and mixing UTC and local-time date math on the same
 * value is exactly the kind of off-by-one that only shows up for users west of
 * Greenwich — so every `Date` here is constructed and read back through its
 * UTC accessors, never the local ones.
 */
export function firstRunOnOrAfter(
  startsOn: string,
  frequency: RecurrenceFrequency,
  dayOfPeriod: number,
): string {
  const start = new Date(`${startsOn}T00:00:00Z`);

  if (frequency === "weekly") {
    // `getUTCDay()` is 0-6 with Sunday at 0; `dayOfPeriod` is ISO, 1-7 with
    // Monday at 1. This maps between them before measuring the gap.
    const current = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
    const delta = (dayOfPeriod - current + 7) % 7;
    start.setUTCDate(start.getUTCDate() + delta);
    return start.toISOString().slice(0, 10);
  }

  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();

  const candidate = (y: number, m: number) => {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(dayOfPeriod, lastDay)));
  };

  let next = candidate(year, month);
  if (next < start) {
    next =
      frequency === "monthly" ? candidate(year, month + 1) : candidate(year + 1, month);
  }

  return next.toISOString().slice(0, 10);
}
