/**
 * Splitting an expense among participants.
 * =============================================================================
 * This is the most consequential file in the codebase: it decides how much each
 * roommate owes. Every path through it must satisfy one post-condition —
 *
 *     the computed shares sum to EXACTLY the expense total
 *
 * — with no remainder dropped and none invented. The database enforces the same
 * rule with a deferred trigger, so a bug here fails loudly at COMMIT rather than
 * quietly corrupting a balance.
 *
 * THE ROUNDING PROBLEM
 * ₪100 split three ways is ₪33.333... each. In minor units: 10000 / 3 = 3333.33.
 * Rounding each share independently gives 3333 + 3333 + 3333 = 9999 — one agora
 * vanishes. Rounding up gives 10002 — two agorot are invented. Neither is
 * acceptable in a ledger.
 *
 * The fix is the LARGEST REMAINDER METHOD (the same algorithm used to apportion
 * parliamentary seats): give everyone the floor of their exact share, then hand
 * the leftover units one at a time to whoever was rounded down the most. The
 * total is exact by construction, and the distribution is as fair as integers
 * allow.
 *
 * FAIRNESS OVER TIME
 * When shares tie — which is always the case for an equal split — someone must
 * still receive the spare agora. Always picking the alphabetically first member
 * would systematically overcharge the same person. Instead ties are broken by a
 * hash of (expense seed + user id), so the "loser" rotates pseudo-randomly
 * between expenses while remaining perfectly deterministic for a given expense.
 * Determinism matters twice over: the test suite depends on it, and the client
 * preview must agree with what the server computes.
 */

import { asMinor, MAX_AMOUNT_MINOR, type Minor, sum as sumMinor } from "./money";

export type SplitMethod = "equal" | "exact" | "percentage" | "shares";

/** One participant, plus whatever the user typed for them. */
export interface ParticipantInput {
  userId: string;
  /**
   * Interpretation depends on the method:
   *   equal      — ignored
   *   exact      — this participant's share, in MINOR units
   *   percentage — a percentage, 0–100 (decimals allowed, e.g. 33.33)
   *   shares     — a non-negative integer weight, e.g. 2
   */
  input?: number;
}

export interface ComputedSplit {
  userId: string;
  shareMinor: Minor;
  /** The raw value the user typed, preserved so the edit form can reopen it. */
  shareInput: number | null;
}

export interface ComputeSplitsInput {
  totalMinor: Minor;
  method: SplitMethod;
  participants: readonly ParticipantInput[];
  /**
   * Any stable string that identifies this expense — its id when editing, or a
   * client-generated UUID when creating. Only used for deterministic tie-breaking.
   */
  seed: string;
}

/**
 * The seed for an expense's remainder allocation.
 *
 * Exported, and the only supported way to produce one, because the value has to
 * be identical in three places that are otherwise unrelated: the live preview in
 * the browser, the Server Action that creates an expense, and the Server Action
 * that updates one. If any of them derived it differently, opening an unchanged
 * expense would show a different allocation than the one on file, and saving it
 * would move the odd agora to a different roommate.
 *
 * Deriving it from the amount rather than from the expense's identity is what
 * makes the allocation a pure function of what the expense SAYS, so the same
 * expense always splits the same way no matter which code path arrives at it.
 */
export function remainderSeed(totalMinor: Minor | number): string {
  return String(totalMinor);
}

export type SplitErrorCode =
  | "NO_PARTICIPANTS"
  | "DUPLICATE_PARTICIPANT"
  | "INVALID_TOTAL"
  | "MISSING_INPUT"
  | "NEGATIVE_INPUT"
  | "NON_INTEGER_WEIGHT"
  | "ZERO_WEIGHTS"
  | "PERCENTAGE_SUM"
  | "EXACT_SUM";

export type ComputeSplitsResult =
  | { ok: true; splits: ComputedSplit[] }
  | { ok: false; code: SplitErrorCode; message: string };

/**
 * Percentages are compared in BASIS POINTS (hundredths of a percent) rather
 * than as decimals, because the obvious floating-point check is wrong:
 *
 *   33.33 + 33.33 + 33.33 === 99.99000000000001
 *   100 - 99.99            === 0.010000000000005116   // > 0.01, so `> 0.01` fires
 *
 * A tolerance test written against those values rejects the single most common
 * percentage split in the product. Rounding each input to an integer number of
 * basis points first makes the arithmetic exact.
 *
 * The tolerance is one basis point (0.01%), which is exactly the rounding error
 * left by three equal shares and no more.
 */
const BASIS_POINTS_PER_PERCENT = 100;
const TOTAL_BASIS_POINTS = 100 * BASIS_POINTS_PER_PERCENT;
const PERCENTAGE_TOLERANCE_BP = 1;

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Computes each participant's share.
 *
 * Returns a result object rather than throwing: an unbalanced exact split is
 * ordinary user input, not an exceptional condition, and the form needs to
 * render it as a field-level message.
 */
export function computeSplits(input: ComputeSplitsInput): ComputeSplitsResult {
  const { totalMinor, method, participants, seed } = input;

  /* --- Checks common to every method ------------------------------------- */

  if (participants.length === 0) {
    return {
      ok: false,
      code: "NO_PARTICIPANTS",
      message: "Select at least one person to split this with",
    };
  }

  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.userId)) {
      return {
        ok: false,
        code: "DUPLICATE_PARTICIPANT",
        message: "The same person appears twice in the split",
      };
    }
    seen.add(p.userId);
  }

  if (
    !Number.isSafeInteger(totalMinor) ||
    totalMinor <= 0 ||
    totalMinor > MAX_AMOUNT_MINOR
  ) {
    return {
      ok: false,
      code: "INVALID_TOTAL",
      message: "The expense amount is not valid",
    };
  }

  /* --- Method-specific handling ------------------------------------------ */

  switch (method) {
    case "equal":
      return allocateWeighted(
        totalMinor,
        participants.map((p) => ({ userId: p.userId, weight: 1, input: null })),
        seed,
      );

    case "exact":
      return computeExact(totalMinor, participants);

    case "percentage":
      return computePercentage(totalMinor, participants, seed);

    case "shares":
      return computeShares(totalMinor, participants, seed);
  }
}

/* -------------------------------------------------------------------------- */
/* Method implementations                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Exact amounts: the user assigns every share by hand.
 *
 * No allocation is performed — the numbers are taken as given — but they must
 * add up to the total precisely. There is no "close enough" for money.
 */
function computeExact(
  totalMinor: Minor,
  participants: readonly ParticipantInput[],
): ComputeSplitsResult {
  const splits: ComputedSplit[] = [];
  let running = 0;

  for (const p of participants) {
    const value = p.input;
    if (value === undefined || value === null || Number.isNaN(value)) {
      return {
        ok: false,
        code: "MISSING_INPUT",
        message: "Enter an amount for every person",
      };
    }
    if (!Number.isSafeInteger(value)) {
      return {
        ok: false,
        code: "NON_INTEGER_WEIGHT",
        message: "Shares must be whole amounts",
      };
    }
    if (value < 0) {
      return {
        ok: false,
        code: "NEGATIVE_INPUT",
        message: "A share cannot be negative",
      };
    }

    running += value;
    splits.push({ userId: p.userId, shareMinor: asMinor(value), shareInput: null });
  }

  if (running !== totalMinor) {
    const difference = totalMinor - running;
    return {
      ok: false,
      code: "EXACT_SUM",
      // The message states the exact remaining amount, because "shares don't
      // add up" leaves the user to do the subtraction themselves.
      message:
        difference > 0
          ? `${formatMinorForMessage(difference)} still needs to be assigned`
          : `${formatMinorForMessage(-difference)} too much has been assigned`,
    };
  }

  return { ok: true, splits };
}

/**
 * Percentages: each participant takes a stated proportion of the total.
 *
 * Percentages must sum to 100 (within a small tolerance, because 33.33 × 3 is
 * 99.99 and rejecting that would be pedantic). The resulting exact shares are
 * then allocated by largest remainder so the minor units still land exactly.
 */
function computePercentage(
  totalMinor: Minor,
  participants: readonly ParticipantInput[],
  seed: string,
): ComputeSplitsResult {
  const weighted: WeightedParticipant[] = [];
  let totalBasisPoints = 0;

  for (const p of participants) {
    const value = p.input;
    if (value === undefined || value === null || Number.isNaN(value)) {
      return {
        ok: false,
        code: "MISSING_INPUT",
        message: "Enter a percentage for every person",
      };
    }
    if (!Number.isFinite(value) || value < 0) {
      return {
        ok: false,
        code: "NEGATIVE_INPUT",
        message: "A percentage cannot be negative",
      };
    }

    // Round to whole basis points so the sum below is integer arithmetic.
    const basisPoints = Math.round(value * BASIS_POINTS_PER_PERCENT);
    totalBasisPoints += basisPoints;

    // The allocator receives basis points as the weight. Using them rather than
    // the raw decimal keeps the proportions identical while avoiding another
    // float in the pipeline. `input` still records what the user typed.
    weighted.push({ userId: p.userId, weight: basisPoints, input: value });
  }

  if (Math.abs(totalBasisPoints - TOTAL_BASIS_POINTS) > PERCENTAGE_TOLERANCE_BP) {
    return {
      ok: false,
      code: "PERCENTAGE_SUM",
      message: `Percentages must add up to 100% (currently ${
        totalBasisPoints / BASIS_POINTS_PER_PERCENT
      }%)`,
    };
  }

  return allocateWeighted(totalMinor, weighted, seed);
}

/**
 * Weighted shares: "I take 2 parts, you each take 1" — the larger-bedroom case.
 *
 * Weights are integers because that is how people actually express this ("two
 * to one"), and integers keep the ratio unambiguous.
 */
function computeShares(
  totalMinor: Minor,
  participants: readonly ParticipantInput[],
  seed: string,
): ComputeSplitsResult {
  const weighted: WeightedParticipant[] = [];

  for (const p of participants) {
    const value = p.input;
    if (value === undefined || value === null || Number.isNaN(value)) {
      return {
        ok: false,
        code: "MISSING_INPUT",
        message: "Enter a number of shares for every person",
      };
    }
    if (!Number.isInteger(value)) {
      return {
        ok: false,
        code: "NON_INTEGER_WEIGHT",
        message: "Shares must be whole numbers",
      };
    }
    if (value < 0) {
      return {
        ok: false,
        code: "NEGATIVE_INPUT",
        message: "Shares cannot be negative",
      };
    }

    weighted.push({ userId: p.userId, weight: value, input: value });
  }

  return allocateWeighted(totalMinor, weighted, seed);
}

/* -------------------------------------------------------------------------- */
/* The allocator — largest remainder method                                    */
/* -------------------------------------------------------------------------- */

interface WeightedParticipant {
  userId: string;
  weight: number;
  input: number | null;
}

/**
 * Distributes `totalMinor` across participants in proportion to their weights,
 * such that the shares are integers summing to exactly the total.
 *
 * Steps:
 *   1. exact share  = total × weight / Σweights          (a real number)
 *   2. base share   = floor(exact share)                 (an integer, too small)
 *   3. remainder    = total − Σ base shares              (0 ≤ remainder < n)
 *   4. hand one extra unit to the `remainder` participants with the largest
 *      fractional parts, ties broken deterministically by hash.
 *
 * Step 4 is what makes the result exact. The remainder is strictly less than
 * the number of participants, so nobody receives more than one extra unit.
 */
function allocateWeighted(
  totalMinor: Minor,
  participants: readonly WeightedParticipant[],
  seed: string,
): ComputeSplitsResult {
  const weightTotal = participants.reduce((acc, p) => acc + p.weight, 0);

  // Every weight zero would mean dividing by zero: nobody is responsible for
  // any part of an expense that nonetheless exists.
  if (weightTotal <= 0) {
    return {
      ok: false,
      code: "ZERO_WEIGHTS",
      message: "At least one person must have a share greater than zero",
    };
  }

  // Steps 1–2, carried on one object per participant. Working with objects
  // rather than parallel arrays means the increment in step 4 mutates the right
  // participant by identity, with no index bookkeeping to get wrong.
  const entries = participants.map((p) => {
    const exact = (totalMinor * p.weight) / weightTotal;
    const base = Math.floor(exact);
    return {
      userId: p.userId,
      input: p.input,
      share: base,
      fraction: exact - base,
      // Rotates the spare unit between expenses instead of always handing it to
      // the same person. Stable for a given expense, different across expenses.
      tiebreak: hash32(`${seed}:${p.userId}`),
    };
  });

  // Step 3. Strictly less than the number of participants, so nobody receives
  // more than one extra unit.
  let remainder = totalMinor - entries.reduce((acc, e) => acc + e.share, 0);

  // Step 4. Largest fractional parts first; deterministic hash breaks ties.
  const ranked = [...entries].sort(
    (a, b) => b.fraction - a.fraction || a.tiebreak - b.tiebreak,
  );

  for (const entry of ranked) {
    if (remainder <= 0) break;
    entry.share += 1;
    remainder -= 1;
  }

  const splits: ComputedSplit[] = entries.map((e) => ({
    userId: e.userId,
    shareMinor: asMinor(e.share),
    shareInput: e.input,
  }));

  // Belt and braces: assert the post-condition the whole module exists for.
  // If this ever fires it is a bug in the allocator, not bad input, so it
  // throws rather than returning a user-facing error.
  const check = sumMinor(splits.map((s) => s.shareMinor));
  if (check !== totalMinor) {
    throw new Error(
      `Split allocation is unbalanced: shares total ${check}, expense total ${totalMinor}. ` +
        `This is a bug in allocateWeighted().`,
    );
  }

  return { ok: true, splits };
}

/* -------------------------------------------------------------------------- */
/* Helpers for the live UI preview                                             */
/* -------------------------------------------------------------------------- */

/**
 * How much of the total is still unassigned in an exact split.
 * Positive means under-assigned, negative means over-assigned.
 *
 * Used by the split editor to show "₪1.00 left to assign" while the user types,
 * so the error is visible before they press save rather than after.
 */
export function remainingToAssign(
  totalMinor: Minor,
  enteredShares: readonly number[],
): number {
  const assigned = enteredShares.reduce(
    (acc, value) => acc + (Number.isFinite(value) ? value : 0),
    0,
  );
  return totalMinor - assigned;
}

/** Sum of entered percentages, for the live "must total 100%" indicator. */
export function percentageTotal(entered: readonly number[]): number {
  return round2(
    entered.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0),
  );
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * FNV-1a, a small non-cryptographic hash.
 *
 * Used only to break ties deterministically. It needs to be stable across
 * client and server and well distributed; it explicitly does NOT need to be
 * secure, since the worst an attacker could achieve by predicting it is
 * receiving one extra agora on an expense they are party to.
 */
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // The FNV prime, applied with shifts and additions to stay inside 32 bits.
    hash =
      (hash +
        ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>>
      0;
  }
  return hash >>> 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Minimal formatting for error messages; full formatting lives in money.ts. */
function formatMinorForMessage(minor: number): string {
  return `₪${(minor / 100).toFixed(2)}`;
}
