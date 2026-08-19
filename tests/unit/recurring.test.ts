/**
 * Recurring-rule scheduling.
 * =============================================================================
 * The two things a scheduler must never do: fire in the past, and silently
 * shift a fixed day into a different month. Every test here is one of those
 * two failure modes made concrete.
 */

import { describe, expect, it } from "vitest";

import { firstRunOnOrAfter } from "@/lib/domain/recurring";

describe("firstRunOnOrAfter", () => {
  describe("monthly", () => {
    it("uses this month's date when it has not passed yet", () => {
      expect(firstRunOnOrAfter("2026-08-01", "monthly", 15)).toBe("2026-08-15");
    });

    it("rolls to next month when this month's date has already passed", () => {
      expect(firstRunOnOrAfter("2026-08-20", "monthly", 15)).toBe("2026-09-15");
    });

    it("fires today when starting exactly on the target day", () => {
      expect(firstRunOnOrAfter("2026-08-15", "monthly", 15)).toBe("2026-08-15");
    });

    it("clamps the 31st to February's last day in a non-leap year", () => {
      expect(firstRunOnOrAfter("2026-01-01", "monthly", 31)).toBe("2026-01-31");
      // Rolling forward from a January start once the 31st has passed should
      // land on the 28th, not skip February or wrap into March.
      expect(firstRunOnOrAfter("2026-02-01", "monthly", 31)).toBe("2026-02-28");
    });

    it("clamps the 31st to February's last day in a leap year", () => {
      expect(firstRunOnOrAfter("2028-02-01", "monthly", 31)).toBe("2028-02-29");
    });

    it("does not compound the clamp into the following month", () => {
      // A rule fired in February at the clamped 28th must return to the true
      // 31st in March, not continue from the 28th.
      expect(firstRunOnOrAfter("2026-03-01", "monthly", 31)).toBe("2026-03-31");
    });

    it("never returns a date before startsOn", () => {
      const result = firstRunOnOrAfter("2026-08-20", "monthly", 1);
      expect(result >= "2026-08-20").toBe(true);
    });
  });

  describe("yearly", () => {
    it("uses this year's date when it has not passed yet", () => {
      expect(firstRunOnOrAfter("2026-01-01", "yearly", 15)).toBe("2026-01-15");
    });

    it("rolls to next year when this year's date has already passed", () => {
      expect(firstRunOnOrAfter("2026-08-20", "yearly", 15)).toBe("2027-08-15");
    });

    it("clamps 29 February to 28 in a non-leap year", () => {
      // The month itself is fixed by startsOn (February); only the day clamps.
      expect(firstRunOnOrAfter("2026-02-01", "yearly", 29)).toBe("2026-02-28");
    });
  });

  describe("weekly", () => {
    it("uses today when today is already the target weekday", () => {
      // 2026-08-03 is a Monday.
      expect(firstRunOnOrAfter("2026-08-03", "weekly", 1)).toBe("2026-08-03");
    });

    it("advances to later in the same week", () => {
      // Monday -> Friday of the same week.
      expect(firstRunOnOrAfter("2026-08-03", "weekly", 5)).toBe("2026-08-07");
    });

    it("wraps to the following week when the target day has passed", () => {
      // Friday -> the following Monday, not this week's (already-passed) Monday.
      expect(firstRunOnOrAfter("2026-08-07", "weekly", 1)).toBe("2026-08-10");
    });

    it("treats Sunday as ISO day 7, not 0", () => {
      // 2026-08-03 is a Monday; the next Sunday is 2026-08-09.
      expect(firstRunOnOrAfter("2026-08-03", "weekly", 7)).toBe("2026-08-09");
    });
  });
});
