/**
 * Unit tests — split calculation.
 *
 * The post-condition under test throughout this file is the one the whole
 * product depends on:
 *
 *     the computed shares sum to EXACTLY the expense total
 *
 * Individual cases check the four split methods and their validation rules; the
 * property-based section at the end throws thousands of randomly generated
 * inputs at the allocator and asserts the invariant holds for every one.
 */

import { describe, expect, it } from "vitest";
import { asMinor, type Minor } from "@/lib/domain/money";
import {
  computeSplits,
  percentageTotal,
  remainderSeed,
  remainingToAssign,
  type ComputeSplitsResult,
  type ParticipantInput,
} from "@/lib/domain/splits";

const MAYA = "11111111-1111-4111-8111-111111111111";
const YONATAN = "22222222-2222-4222-8222-222222222222";
const NOA = "33333333-3333-4333-8333-333333333333";

/** Extracts shares, failing the test with a readable message if unsuccessful. */
function sharesOf(result: ComputeSplitsResult): number[] {
  if (!result.ok) {
    throw new Error(
      `Expected a successful split, got ${result.code}: ${result.message}`,
    );
  }
  return result.splits.map((s) => s.shareMinor);
}

function totalOf(result: ComputeSplitsResult): number {
  return sharesOf(result).reduce((a, b) => a + b, 0);
}

function equalParticipants(): ParticipantInput[] {
  return [{ userId: MAYA }, { userId: YONATAN }, { userId: NOA }];
}

/* -------------------------------------------------------------------------- */

describe("equal split", () => {
  it("divides evenly when the amount is divisible", () => {
    const result = computeSplits({
      totalMinor: asMinor(30000),
      method: "equal",
      participants: equalParticipants(),
      seed: "expense-1",
    });

    expect(sharesOf(result)).toEqual([10000, 10000, 10000]);
  });

  it("distributes an indivisible remainder without losing or inventing an agora", () => {
    // ₪100 across three people. 10000 / 3 = 3333.33..., so two people pay
    // ₪33.33 and one pays ₪33.34.
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "equal",
      participants: equalParticipants(),
      seed: "expense-1",
    });

    const shares = sharesOf(result);
    expect(shares).toHaveLength(3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10000);
    // Exactly one person absorbs the spare agora.
    expect(shares.filter((s) => s === 3334)).toHaveLength(1);
    expect(shares.filter((s) => s === 3333)).toHaveLength(2);
  });

  it("never gives anyone more than one extra unit", () => {
    // 7 people, ₪10.00 → 142.857 each; 6 agorot must be spread one each.
    const participants = Array.from({ length: 7 }, (_, i) => ({
      userId: `user-${i}`,
    }));
    const result = computeSplits({
      totalMinor: asMinor(1000),
      method: "equal",
      participants,
      seed: "expense-x",
    });

    const shares = sharesOf(result);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
    const spread = Math.max(...shares) - Math.min(...shares);
    expect(spread).toBeLessThanOrEqual(1);
  });

  it("handles a single participant paying for themselves", () => {
    const result = computeSplits({
      totalMinor: asMinor(4999),
      method: "equal",
      participants: [{ userId: MAYA }],
      seed: "expense-1",
    });
    expect(sharesOf(result)).toEqual([4999]);
  });

  it("handles the smallest possible amount", () => {
    // One agora between three people: one pays it, two pay nothing. A zero
    // share is legitimate and must not be rejected.
    const result = computeSplits({
      totalMinor: asMinor(1),
      method: "equal",
      participants: equalParticipants(),
      seed: "expense-1",
    });
    const shares = sharesOf(result);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1);
    expect(shares.filter((s) => s === 0)).toHaveLength(2);
  });

  it("is deterministic for a given seed", () => {
    const input = {
      totalMinor: asMinor(10000) as Minor,
      method: "equal" as const,
      participants: equalParticipants(),
      seed: "same-seed",
    };
    expect(sharesOf(computeSplits(input))).toEqual(sharesOf(computeSplits(input)));
  });

  it("rotates which participant absorbs the remainder across expenses", () => {
    // Fairness over time: if the spare agora always went to the same person,
    // that person would be systematically overcharged. Different seeds must
    // therefore produce different "losers" at least some of the time.
    const winners = new Set<string>();

    for (let i = 0; i < 40; i++) {
      const result = computeSplits({
        totalMinor: asMinor(10000),
        method: "equal",
        participants: equalParticipants(),
        seed: `expense-${i}`,
      });
      if (!result.ok) throw new Error("expected success");
      const loser = result.splits.find((s) => s.shareMinor === 3334);
      if (loser) winners.add(loser.userId);
    }

    expect(winners.size).toBeGreaterThan(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("exact split", () => {
  it("accepts shares that sum precisely to the total", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "exact",
      participants: [
        { userId: MAYA, input: 5000 },
        { userId: YONATAN, input: 3000 },
        { userId: NOA, input: 2000 },
      ],
      seed: "expense-1",
    });

    expect(sharesOf(result)).toEqual([5000, 3000, 2000]);
  });

  it("rejects an under-assigned split and names the exact shortfall", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "exact",
      participants: [
        { userId: MAYA, input: 5000 },
        { userId: YONATAN, input: 4900 },
      ],
      seed: "expense-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EXACT_SUM");
      // The user should not have to do the subtraction themselves.
      expect(result.message).toContain("1.00");
    }
  });

  it("rejects an over-assigned split", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "exact",
      participants: [
        { userId: MAYA, input: 6000 },
        { userId: YONATAN, input: 5000 },
      ],
      seed: "expense-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXACT_SUM");
  });

  it("rejects a missing or negative share", () => {
    const missing = computeSplits({
      totalMinor: asMinor(10000),
      method: "exact",
      participants: [{ userId: MAYA, input: 10000 }, { userId: YONATAN }],
      seed: "s",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("MISSING_INPUT");

    const negative = computeSplits({
      totalMinor: asMinor(10000),
      method: "exact",
      participants: [
        { userId: MAYA, input: 11000 },
        { userId: YONATAN, input: -1000 },
      ],
      seed: "s",
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.code).toBe("NEGATIVE_INPUT");
  });
});

/* -------------------------------------------------------------------------- */

describe("percentage split", () => {
  it("applies whole percentages", () => {
    // ₪340 electricity, 40/30/30 — the seeded example from the database.
    const result = computeSplits({
      totalMinor: asMinor(34000),
      method: "percentage",
      participants: [
        { userId: MAYA, input: 40 },
        { userId: YONATAN, input: 30 },
        { userId: NOA, input: 30 },
      ],
      seed: "expense-1",
    });

    expect(sharesOf(result)).toEqual([13600, 10200, 10200]);
  });

  it("tolerates 33.33 × 3 = 99.99 and still allocates exactly", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "percentage",
      participants: [
        { userId: MAYA, input: 33.33 },
        { userId: YONATAN, input: 33.33 },
        { userId: NOA, input: 33.33 },
      ],
      seed: "expense-1",
    });

    expect(totalOf(result)).toBe(10000);
  });

  it("rejects percentages that do not add up to 100", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "percentage",
      participants: [
        { userId: MAYA, input: 50 },
        { userId: YONATAN, input: 30 },
      ],
      seed: "expense-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PERCENTAGE_SUM");
      expect(result.message).toContain("80");
    }
  });

  it("rejects a missing or non-finite percentage", () => {
    const missing = computeSplits({
      totalMinor: asMinor(10000),
      method: "percentage",
      participants: [{ userId: MAYA, input: 100 }, { userId: YONATAN }],
      seed: "s",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("MISSING_INPUT");

    const notANumber = computeSplits({
      totalMinor: asMinor(10000),
      method: "percentage",
      participants: [
        { userId: MAYA, input: Number.NaN },
        { userId: YONATAN, input: 100 },
      ],
      seed: "s",
    });
    expect(notANumber.ok).toBe(false);
    if (!notANumber.ok) expect(notANumber.code).toBe("MISSING_INPUT");

    const infinite = computeSplits({
      totalMinor: asMinor(10000),
      method: "percentage",
      participants: [
        { userId: MAYA, input: Number.POSITIVE_INFINITY },
        { userId: YONATAN, input: 50 },
      ],
      seed: "s",
    });
    expect(infinite.ok).toBe(false);
    if (!infinite.ok) expect(infinite.code).toBe("NEGATIVE_INPUT");

    const negative = computeSplits({
      totalMinor: asMinor(10000),
      method: "percentage",
      participants: [
        { userId: MAYA, input: 110 },
        { userId: YONATAN, input: -10 },
      ],
      seed: "s",
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.code).toBe("NEGATIVE_INPUT");
  });

  it("allows a participant with a zero percentage", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "percentage",
      participants: [
        { userId: MAYA, input: 100 },
        { userId: YONATAN, input: 0 },
      ],
      seed: "expense-1",
    });

    expect(sharesOf(result)).toEqual([10000, 0]);
  });

  it("preserves what the user typed, so the edit form can reopen it", () => {
    const result = computeSplits({
      totalMinor: asMinor(34000),
      method: "percentage",
      participants: [
        { userId: MAYA, input: 40 },
        { userId: YONATAN, input: 60 },
      ],
      seed: "expense-1",
    });

    if (!result.ok) throw new Error("expected success");
    expect(result.splits.map((s) => s.shareInput)).toEqual([40, 60]);
  });
});

/* -------------------------------------------------------------------------- */

describe("weighted shares", () => {
  it("splits 2:1:1", () => {
    const result = computeSplits({
      totalMinor: asMinor(40000),
      method: "shares",
      participants: [
        { userId: MAYA, input: 2 },
        { userId: YONATAN, input: 1 },
        { userId: NOA, input: 1 },
      ],
      seed: "expense-1",
    });

    expect(sharesOf(result)).toEqual([20000, 10000, 10000]);
  });

  it("rejects fractional weights", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "shares",
      participants: [
        { userId: MAYA, input: 1.5 },
        { userId: YONATAN, input: 1 },
      ],
      seed: "expense-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NON_INTEGER_WEIGHT");
  });

  it("rejects a missing or negative weight", () => {
    const missing = computeSplits({
      totalMinor: asMinor(10000),
      method: "shares",
      participants: [{ userId: MAYA, input: 1 }, { userId: YONATAN }],
      seed: "s",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("MISSING_INPUT");

    const negative = computeSplits({
      totalMinor: asMinor(10000),
      method: "shares",
      participants: [
        { userId: MAYA, input: 3 },
        { userId: YONATAN, input: -1 },
      ],
      seed: "s",
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.code).toBe("NEGATIVE_INPUT");
  });

  it("rejects a non-integer exact share", () => {
    // Exact shares arrive already converted to minor units, so a fractional
    // value means a decimal amount leaked past the parser.
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "exact",
      participants: [
        { userId: MAYA, input: 5000.5 },
        { userId: YONATAN, input: 4999.5 },
      ],
      seed: "s",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NON_INTEGER_WEIGHT");
  });

  it("rejects an all-zero weighting, which would divide by zero", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "shares",
      participants: [
        { userId: MAYA, input: 0 },
        { userId: YONATAN, input: 0 },
      ],
      seed: "expense-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ZERO_WEIGHTS");
  });
});

/* -------------------------------------------------------------------------- */

describe("shared validation", () => {
  it("requires at least one participant", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "equal",
      participants: [],
      seed: "expense-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_PARTICIPANTS");
  });

  it("rejects a duplicated participant", () => {
    const result = computeSplits({
      totalMinor: asMinor(10000),
      method: "equal",
      participants: [{ userId: MAYA }, { userId: MAYA }],
      seed: "expense-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_PARTICIPANT");
  });

  it.each([0, -100, 100_000_001])("rejects an invalid total (%s)", (total) => {
    const result = computeSplits({
      totalMinor: total as Minor,
      method: "equal",
      participants: equalParticipants(),
      seed: "expense-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_TOTAL");
  });
});

/* -------------------------------------------------------------------------- */

describe("live preview helpers", () => {
  it("reports what is left to assign", () => {
    expect(remainingToAssign(asMinor(10000), [5000, 3000])).toBe(2000);
    expect(remainingToAssign(asMinor(10000), [5000, 6000])).toBe(-1000);
    expect(remainingToAssign(asMinor(10000), [])).toBe(10000);
    // A half-typed field yields NaN, which must not poison the running total.
    expect(remainingToAssign(asMinor(10000), [5000, Number.NaN])).toBe(5000);
  });

  it("totals percentages for the 100% indicator", () => {
    expect(percentageTotal([33.33, 33.33, 33.34])).toBe(100);
    expect(percentageTotal([50, Number.NaN])).toBe(50);
  });
});

/* -------------------------------------------------------------------------- */
/* Property-based tests                                                        */
/* -------------------------------------------------------------------------- */
/**
 * Hand-written cases only cover the situations we thought of. These generate
 * thousands of random splits and assert the invariants for every one, which is
 * how the awkward combinations (prime totals, lopsided weights, many
 * participants) get covered without enumerating them.
 *
 * A seeded generator is used rather than Math.random so that a failure is
 * reproducible: the same run always produces the same inputs.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("property: allocation is always exact", () => {
  it("equal splits sum to the total for 2000 random inputs", () => {
    const random = mulberry32(20260801);

    for (let i = 0; i < 2000; i++) {
      const total = 1 + Math.floor(random() * 5_000_000);
      const count = 1 + Math.floor(random() * 8);
      const participants = Array.from({ length: count }, (_, index) => ({
        userId: `user-${index}`,
      }));

      const result = computeSplits({
        totalMinor: asMinor(total),
        method: "equal",
        participants,
        seed: `seed-${i}`,
      });

      if (!result.ok) throw new Error(`unexpected failure: ${result.code}`);

      const shares = result.splits.map((s) => s.shareMinor);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      expect(shares.every((s) => s >= 0)).toBe(true);
      // No participant may be more than one minor unit away from another.
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
  });

  it("weighted splits sum to the total for 2000 random inputs", () => {
    const random = mulberry32(97531);

    for (let i = 0; i < 2000; i++) {
      const total = 1 + Math.floor(random() * 5_000_000);
      const count = 1 + Math.floor(random() * 8);

      const participants = Array.from({ length: count }, (_, index) => ({
        userId: `user-${index}`,
        input: Math.floor(random() * 10),
      }));

      // Guarantee at least one non-zero weight, otherwise ZERO_WEIGHTS is the
      // correct (and separately tested) outcome.
      const first = participants[0];
      if (first && participants.every((p) => p.input === 0)) first.input = 1;

      const result = computeSplits({
        totalMinor: asMinor(total),
        method: "shares",
        participants,
        seed: `seed-${i}`,
      });

      if (!result.ok) throw new Error(`unexpected failure: ${result.code}`);

      const shares = result.splits.map((s) => s.shareMinor);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      expect(shares.every((s) => s >= 0)).toBe(true);
    }
  });
});

/**
 * Regression. The create path, the update path and the browser's live preview
 * each call `computeSplits` independently, and each has to arrive at the same
 * seed or the odd agora moves between roommates.
 *
 * The bug this pins: the edit form was seeded with the expense id while creation
 * was seeded with the amount, so opening an untouched expense previewed
 * 33.34/33.34/33.33 against a stored 33.33/33.34/33.34. Saving it would have
 * recorded a change nobody made.
 */
describe("remainder allocation is stable across create, edit and preview", () => {
  const participants: ParticipantInput[] = [
    { userId: MAYA },
    { userId: YONATAN },
    { userId: NOA },
  ];

  const splitWith = (seed: string) =>
    sharesOf(
      computeSplits({
        totalMinor: asMinor(10001),
        method: "equal",
        participants,
        seed,
      }),
    );

  it("derives the same seed from the amount however it is expressed", () => {
    expect(remainderSeed(asMinor(10001))).toBe(remainderSeed(10001));
  });

  it("allocates identically for creation and for a later edit", () => {
    const onCreate = splitWith(remainderSeed(asMinor(10001)));
    const onEdit = splitWith(remainderSeed(asMinor(10001)));

    expect(onEdit).toEqual(onCreate);
    expect(onCreate.reduce((a, b) => a + b, 0)).toBe(10001);
  });

  it("is genuinely driven by the seed, so the check above is not vacuous", () => {
    // If the seed were ignored, every allocation would be identical and the
    // stability assertion above would pass for the wrong reason. Some seeds
    // coincide by chance — there are only three places the odd agora can land —
    // so this asserts that a differing allocation exists rather than that any
    // particular seed produces one.
    const byAmount = splitWith(remainderSeed(asMinor(10001)));

    const allocations = Array.from({ length: 25 }, (_, i) => splitWith(`seed-${i}`));

    expect(
      allocations.every((shares) => shares.reduce((a, b) => a + b, 0) === 10001),
    ).toBe(true);
    expect(allocations.some((shares) => shares.join() !== byAmount.join())).toBe(true);
  });
});
