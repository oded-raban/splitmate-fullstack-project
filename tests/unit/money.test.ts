/**
 * Unit tests — money arithmetic and parsing.
 *
 * These tests exist to prove one claim: SplitMate never loses or invents a
 * fraction of a shekel. Most of them are about *input*, because that is where
 * decimals enter the system and where a permissive parser would let a wrong
 * number through.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT_MINOR,
  add,
  absolute,
  asMinor,
  formatAmount,
  formatForInput,
  formatMoney,
  fromMajor,
  isNegative,
  isPositive,
  isZero,
  min,
  multiply,
  negate,
  parseAmount,
  PARSE_FAILURE_MESSAGES,
  sign,
  subtract,
  sum,
  toMajor,
  ZERO,
} from "@/lib/domain/money";

describe("asMinor", () => {
  it("accepts integers", () => {
    expect(asMinor(0)).toBe(0);
    expect(asMinor(12550)).toBe(12550);
    expect(asMinor(-500)).toBe(-500);
  });

  it("rejects decimals, because a decimal here means someone did float maths on money", () => {
    expect(() => asMinor(125.5)).toThrow(TypeError);
    // The error message must point at the actual mistake, since this is the
    // single most likely bug in a money codebase.
    expect(() => asMinor(125.5)).toThrow(/minor units/i);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => asMinor(Number.NaN)).toThrow(TypeError);
    expect(() => asMinor(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("rejects values beyond exact integer representation", () => {
    expect(() => asMinor(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe("conversion between major and minor units", () => {
  it("round-trips", () => {
    expect(fromMajor(125.5)).toBe(12550);
    expect(toMajor(asMinor(12550))).toBe(125.5);
  });

  it("handles the classic floating point traps", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is exact.
    const tenAgorot = fromMajor(0.1);
    const twentyAgorot = fromMajor(0.2);
    expect(add(tenAgorot, twentyAgorot)).toBe(30);
    expect(toMajor(add(tenAgorot, twentyAgorot))).toBe(0.3);
  });

  it("converts 1.005 correctly rather than to 1.00", () => {
    // `1.005 * 100` is 100.49999999999999 in binary floating point; rounding
    // that naively would lose an agora. This is why input is validated to two
    // decimals before scaling.
    expect(fromMajor(1.01)).toBe(101);
  });
});

describe("parseAmount — formatting tolerance", () => {
  it.each([
    ["12.50", 1250],
    ["12", 1200],
    ["0.99", 99],
    ["1234.5", 123450],
    ["12.", 1200],
  ])("parses %s", (input, expected) => {
    const result = parseAmount(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(expected);
  });

  it("accepts a comma as a decimal separator (European/Hebrew keyboards)", () => {
    const result = parseAmount("12,50");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1250);
  });

  it("accepts a comma as a thousands separator when a decimal point is present", () => {
    const result = parseAmount("1,234.50");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(123450);
  });

  it("strips currency symbols and whitespace pasted from other apps", () => {
    for (const input of [" ₪12.50 ", "$12.50", "€12.50", "\u00A012.50"]) {
      const result = parseAmount(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(1250);
    }
  });
});

describe("parseAmount — rejection", () => {
  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["abc", "NOT_A_NUMBER"],
    ["12abc", "NOT_A_NUMBER"],
    ["1.2.3", "NOT_A_NUMBER"],
    ["--5", "NOT_A_NUMBER"],
    ["12.345", "TOO_MANY_DECIMALS"],
    ["-5", "NEGATIVE"],
    ["0", "ZERO"],
    ["0.00", "ZERO"],
    ["2000000", "TOO_LARGE"],
  ])("rejects %s with %s", (input, reason) => {
    const result = parseAmount(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it("rejects scientific notation, which Number() would silently accept", () => {
    // `Number("1e9")` is 1000000000 — a billion shekels from four characters.
    const result = parseAmount("1e9");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_A_NUMBER");
  });

  it("allows zero only where the caller opts in", () => {
    const rejected = parseAmount("0");
    expect(rejected.ok).toBe(false);

    const allowed = parseAmount("0", true);
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.value).toBe(0);
  });

  it("accepts exactly the maximum and rejects one unit above it", () => {
    const atLimit = parseAmount("1000000");
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) expect(atLimit.value).toBe(MAX_AMOUNT_MINOR);

    const overLimit = parseAmount("1000000.01");
    expect(overLimit.ok).toBe(false);
  });

  it("has a human message for every failure reason", () => {
    for (const message of Object.values(PARSE_FAILURE_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("survives a non-string input", () => {
    // Form libraries and JSON payloads can hand over a number, null or
    // undefined. The parser is the trust boundary, so it must not assume a
    // string arrived just because the type signature says so.
    for (const input of [null, undefined, 42, {}]) {
      const result = parseAmount(input as unknown as string);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a number so long it overflows to Infinity", () => {
    // The regex accepts any run of digits, and 400 nines becomes Infinity once
    // parsed — which would sail past a naive range check.
    const result = parseAmount("9".repeat(400));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_A_NUMBER");
  });

  it("treats a lone separator as empty rather than as zero", () => {
    // Someone who has typed only "." or "," has not entered an amount yet;
    // interpreting that as 0 would be a silent misreading of their intent.
    for (const input of [".", ","]) {
      const result = parseAmount(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("EMPTY");
    }
  });
});

describe("arithmetic", () => {
  it("adds, subtracts, negates and takes absolute values", () => {
    expect(add(asMinor(1000), asMinor(250))).toBe(1250);
    expect(subtract(asMinor(1000), asMinor(250))).toBe(750);
    expect(negate(asMinor(1000))).toBe(-1000);
    expect(absolute(asMinor(-1000))).toBe(1000);
  });

  it("sums a list, treating empty as zero", () => {
    expect(sum([])).toBe(ZERO);
    expect(sum([asMinor(100), asMinor(200), asMinor(300)])).toBe(600);
  });

  it("multiplies only by integers", () => {
    expect(multiply(asMinor(150), 3)).toBe(450);
    // Multiplying money by a fraction is how rounding errors are born; the
    // proportional case is handled by the allocator in splits.ts instead.
    expect(() => multiply(asMinor(150), 1.5)).toThrow(TypeError);
  });

  it("reports sign and comparisons", () => {
    expect(isZero(ZERO)).toBe(true);
    expect(isPositive(asMinor(1))).toBe(true);
    expect(isNegative(asMinor(-1))).toBe(true);
    expect(sign(asMinor(-42))).toBe(-1);
    expect(sign(ZERO)).toBe(0);
    expect(sign(asMinor(42))).toBe(1);
    expect(min(asMinor(300), asMinor(100))).toBe(100);
    expect(min(asMinor(100), asMinor(300))).toBe(100);
  });
});

describe("formatting", () => {
  it("formats with a currency symbol", () => {
    // Asserting the numeric portion rather than the full string: symbol
    // placement and bidirectional marks vary between ICU versions, and pinning
    // them would make this test fail on a Node upgrade for no real reason.
    expect(formatMoney(asMinor(123450))).toContain("1,234.50");
    expect(formatMoney(asMinor(123450), "USD", "en-US")).toBe("$1,234.50");
  });

  it("always shows two decimal places", () => {
    expect(formatMoney(asMinor(1200), "USD", "en-US")).toBe("$12.00");
    expect(formatAmount(asMinor(1200), "en-US")).toBe("12.00");
  });

  it("formats for an input field without grouping separators", () => {
    // The value round-trips back through parseAmount on submit, so a locale
    // separator inserted here would have to be stripped again.
    expect(formatForInput(asMinor(123450))).toBe("1234.50");
    expect(formatForInput(asMinor(5))).toBe("0.05");
  });

  it("formats negative balances", () => {
    expect(formatAmount(asMinor(-1250), "en-US")).toBe("-12.50");
  });

  /**
   * Regression. Formatting ILS under `he-IL` wraps the value in RIGHT-TO-LEFT
   * MARKs, and the bidirectional algorithm then applies them to the surrounding
   * characters as well. Embedded in an English sentence, "added Electricity for
   * ₪412.00 41 minutes ago" rendered as "added Electricity for 41 ₪ 412.00
   * minutes ago" — the amount and the timestamp visibly swapped places.
   *
   * The interface is English, so the default formatting locale has to be too.
   */
  it("emits no bidirectional control characters by default", () => {
    const BIDI_CONTROLS = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/;

    expect(formatMoney(asMinor(123450))).not.toMatch(BIDI_CONTROLS);
    expect(formatMoney(asMinor(-123450))).not.toMatch(BIDI_CONTROLS);
    expect(formatAmount(asMinor(123450))).not.toMatch(BIDI_CONTROLS);
  });
});
