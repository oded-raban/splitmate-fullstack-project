/**
 * Money arithmetic in minor units.
 * =============================================================================
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 *
 * Money is never a floating-point number. IEEE-754 binary floating point cannot
 * represent 0.1 exactly, so `0.1 + 0.2 === 0.30000000000000004`. On a single
 * value that error is invisible; across a household's ledger it accumulates,
 * and a balance that should read ₪0.00 reads ₪0.0000000001 — which the UI then
 * rounds to zero while the "settle up" button stays enabled forever.
 *
 * So every amount in SplitMate is an INTEGER in the currency's smallest unit:
 * agorot for ILS, cents for USD. ₪125.50 is the integer 12550. Addition,
 * subtraction and comparison of integers are exact, and every test is
 * deterministic.
 *
 * Conversion to and from human-readable decimals happens exactly twice: once
 * when parsing user input (`parseAmount`), and once when rendering
 * (`formatMoney`). Nothing between those two points ever sees a decimal.
 *
 * WHY A BRANDED TYPE
 * `Minor` is `number` with a phantom property attached. It compiles to a plain
 * number with zero runtime cost, but TypeScript refuses to pass a raw `number`
 * where a `Minor` is expected. That turns "I accidentally passed 125.5 instead
 * of 12550" from a silent financial bug into a compile error.
 */

declare const minorBrand: unique symbol;

/** An integer amount in the currency's smallest unit (agorot, cents). */
export type Minor = number & { readonly [minorBrand]: true };

/**
 * Minor units per major unit. 100 for every currency SplitMate supports
 * (ILS, USD, EUR, GBP).
 *
 * Note for a future multi-currency version: this is NOT universal. JPY has no
 * minor unit (factor 1) and KWD has three decimal places (factor 1000). The
 * constant is centralised here so that adding those currencies means changing
 * one lookup, not auditing every arithmetic site in the codebase.
 */
export const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Upper bound on any single amount: 1,000,000.00 in major units.
 *
 * This is a sanity ceiling, not a business limit. Its real job is catching a
 * misplaced decimal point or a pasted account number before that value reaches
 * a balance, where it would be far more confusing to diagnose.
 */
export const MAX_AMOUNT_MINOR = 100_000_000 as Minor;

/** Result of parsing untrusted user input. */
export type ParseResult =
  { ok: true; value: Minor } | { ok: false; reason: ParseFailure };

export type ParseFailure =
  "EMPTY" | "NOT_A_NUMBER" | "TOO_MANY_DECIMALS" | "NEGATIVE" | "ZERO" | "TOO_LARGE";

/* -------------------------------------------------------------------------- */
/* Construction                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Asserts that a raw number is a valid minor-unit amount and brands it.
 *
 * This is the only sanctioned way to create a `Minor` from arbitrary arithmetic.
 * It throws rather than returning an error because a non-integer here means a
 * programming mistake (someone did floating-point maths on money), not bad user
 * input — and failing loudly at the point of the mistake is far cheaper to
 * debug than a wrong number surfacing three screens later.
 */
export function asMinor(value: number): Minor {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Money amount must be finite, received ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `Money must be an integer number of minor units, received ${value}. ` +
        `Did you pass a decimal amount (e.g. 125.50) instead of minor units (12550)?`,
    );
  }
  // Beyond 2^53 integers stop being exactly representable, which would silently
  // reintroduce the very problem this module exists to prevent.
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money amount ${value} exceeds the safe integer range`);
  }
  return value as Minor;
}

/** Zero, as a correctly typed amount. */
export const ZERO = 0 as Minor;

/**
 * Converts a major-unit decimal to minor units.
 *
 * Rounds rather than truncates, and does so via `Math.round` on a value scaled
 * by 100. `1.005 * 100` is `100.49999999999999` in binary floating point, so
 * this is deliberately applied only to values that have already been validated
 * to have at most two decimal places (see `parseAmount`), where the scaling is
 * exact.
 */
export function fromMajor(major: number): Minor {
  return asMinor(Math.round(major * MINOR_UNITS_PER_MAJOR));
}

/** Converts minor units back to a major-unit number. For display only. */
export function toMajor(minor: Minor): number {
  return minor / MINOR_UNITS_PER_MAJOR;
}

/* -------------------------------------------------------------------------- */
/* Parsing user input                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Parses an amount typed by a human into minor units.
 *
 * Deliberately permissive about *formatting* and strict about *value*, because
 * the input arrives from someone standing in a supermarket queue:
 *
 *   accepted:  "12.50"  "12,50"  "₪12.50"  " 1,234.5 "  "12."  "12"
 *   rejected:  ""  "abc"  "12.345"  "-5"  "0"  "1e9"
 *
 * Returns a discriminated result rather than throwing, because invalid input is
 * an expected, routine event that the form must render as a field message — not
 * an exceptional condition.
 *
 * @param input        Raw string from a text field.
 * @param allowZero    Some contexts (an estimated shopping price) permit zero.
 */
export function parseAmount(input: string, allowZero = false): ParseResult {
  if (typeof input !== "string") return { ok: false, reason: "NOT_A_NUMBER" };

  // Strip currency symbols, spaces (including the non-breaking space that
  // copy-paste from a bank statement introduces) and thousands separators.
  // A comma is treated as a decimal separator only when it is the sole
  // separator present and is followed by one or two digits — "1,234.50" means
  // one thousand, but "12,50" means twelve and a half in Hebrew/European input.
  let cleaned = input.replace(/[\s\u00A0\u200f\u200e]/g, "").replace(/[₪$€£]/g, "");

  if (cleaned.length === 0) return { ok: false, reason: "EMPTY" };

  const hasDot = cleaned.includes(".");
  const commaCount = (cleaned.match(/,/g) ?? []).length;

  if (!hasDot && commaCount === 1 && /,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  // A trailing separator is a half-typed number, not an error: "12." is 12.
  if (cleaned.endsWith(".")) cleaned = cleaned.slice(0, -1);

  if (cleaned.length === 0) return { ok: false, reason: "EMPTY" };

  // Strict shape check. This rejects "1e9", "0x10", "1.2.3", "--5" and "12abc",
  // all of which `Number()` would happily accept or partially accept.
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return { ok: false, reason: "NOT_A_NUMBER" };
  }

  // More precision than the currency has cannot be represented, and silently
  // rounding someone's ₪12.345 would be a surprise. Reject and say why.
  const decimals = cleaned.split(".")[1];
  if (decimals !== undefined && decimals.length > 2) {
    return { ok: false, reason: "TOO_MANY_DECIMALS" };
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { ok: false, reason: "NOT_A_NUMBER" };
  if (parsed < 0) return { ok: false, reason: "NEGATIVE" };
  if (parsed === 0 && !allowZero) return { ok: false, reason: "ZERO" };

  const minor = Math.round(parsed * MINOR_UNITS_PER_MAJOR);
  if (minor > MAX_AMOUNT_MINOR) return { ok: false, reason: "TOO_LARGE" };

  return { ok: true, value: minor as Minor };
}

/** Human-readable explanation for each parse failure, for form field errors. */
export const PARSE_FAILURE_MESSAGES: Record<ParseFailure, string> = {
  EMPTY: "Enter an amount",
  NOT_A_NUMBER: "That doesn't look like an amount",
  TOO_MANY_DECIMALS: "Use at most two decimal places",
  NEGATIVE: "Amount must be positive",
  ZERO: "Amount must be greater than zero",
  TOO_LARGE: "That amount is too large",
};

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                  */
/* -------------------------------------------------------------------------- */
// These wrappers exist so that arithmetic on money keeps its brand. Writing
// `a + b` on two `Minor` values yields a plain `number`, which would then flow
// onward unchecked; `add(a, b)` yields a `Minor`.

export function add(a: Minor, b: Minor): Minor {
  return asMinor(a + b);
}

export function subtract(a: Minor, b: Minor): Minor {
  return asMinor(a - b);
}

export function negate(a: Minor): Minor {
  return asMinor(-a);
}

export function absolute(a: Minor): Minor {
  return asMinor(Math.abs(a));
}

/** Sums any number of amounts. Returns ZERO for an empty list. */
export function sum(amounts: readonly Minor[]): Minor {
  let total = 0;
  for (const amount of amounts) total += amount;
  return asMinor(total);
}

/** Multiplies by an integer count (e.g. quantity × unit price). */
export function multiply(amount: Minor, factor: number): Minor {
  if (!Number.isInteger(factor)) {
    throw new TypeError(`Money can only be multiplied by an integer, got ${factor}`);
  }
  return asMinor(amount * factor);
}

export function isZero(amount: Minor): boolean {
  return amount === 0;
}

export function isPositive(amount: Minor): boolean {
  return amount > 0;
}

export function isNegative(amount: Minor): boolean {
  return amount < 0;
}

/** -1, 0 or 1 — the direction of a balance. */
export function sign(amount: Minor): -1 | 0 | 1 {
  return amount === 0 ? 0 : amount > 0 ? 1 : -1;
}

/** The smaller of two amounts. Used by the debt-simplification matcher. */
export function min(a: Minor, b: Minor): Minor {
  return (a <= b ? a : b) as Minor;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Formats an amount for display, e.g. `₪1,234.50`.
 *
 * Uses `Intl.NumberFormat` rather than string concatenation so that symbol
 * placement, grouping separators and right-to-left handling are correct for the
 * locale — in Hebrew the shekel sign sits differently than a dollar sign does
 * in English, and hand-rolling that is a guaranteed source of small bugs.
 *
 * @param minor    Amount in minor units.
 * @param currency ISO 4217 code, e.g. "ILS".
 * @param locale   BCP 47 tag. Defaults to "he-IL" to match the primary market.
 */
export function formatMoney(minor: Minor, currency = "ILS", locale = "he-IL"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toMajor(minor));
}

/**
 * Formats without a currency symbol, e.g. `1,234.50`.
 * For inputs, tables and CSV export, where the symbol is in the column header.
 */
export function formatAmount(minor: Minor, locale = "he-IL"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toMajor(minor));
}

/**
 * Formats for an editable input field: no grouping separators, always two
 * decimals, no symbol — `1234.50`.
 *
 * Grouping separators must not appear here, because the value round-trips back
 * through `parseAmount` when the user submits, and a locale-specific separator
 * that was inserted for display would then have to be stripped again.
 */
export function formatForInput(minor: Minor): string {
  return (minor / MINOR_UNITS_PER_MAJOR).toFixed(2);
}
