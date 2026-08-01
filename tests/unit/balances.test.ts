/**
 * Unit tests — balance derivation.
 *
 * The headline assertion is the zero-sum invariant: within a household, the
 * members' net positions always add up to exactly zero. If that ever breaks,
 * either an unbalanced expense reached the ledger or the formula is wrong, and
 * both are serious enough that the property is re-checked against randomly
 * generated ledgers at the end of this file.
 */

import { describe, expect, it } from "vitest";
import { asMinor } from "@/lib/domain/money";
import {
  aggregateNet,
  balancesSumToZero,
  deriveBalances,
  summariseFor,
  type LedgerExpense,
  type LedgerSettlement,
} from "@/lib/domain/balances";
import { computeSplits } from "@/lib/domain/splits";

const MAYA = "maya";
const YONATAN = "yonatan";
const NOA = "noa";
const MEMBERS = [MAYA, YONATAN, NOA];

/** Builds an evenly split expense, the way the application would. */
function equalExpense(payerId: string, amount: number, seed: string): LedgerExpense {
  const result = computeSplits({
    totalMinor: asMinor(amount),
    method: "equal",
    participants: MEMBERS.map((userId) => ({ userId })),
    seed,
  });
  if (!result.ok) throw new Error("failed to build test expense");

  return {
    payerId,
    amountMinor: asMinor(amount),
    splits: result.splits.map((s) => ({ userId: s.userId, shareMinor: s.shareMinor })),
  };
}

function netOf(balances: ReturnType<typeof deriveBalances>, userId: string): number {
  return balances.find((b) => b.userId === userId)?.net ?? Number.NaN;
}

/* -------------------------------------------------------------------------- */

describe("deriveBalances", () => {
  it("returns zeros for a household with no activity", () => {
    const balances = deriveBalances(MEMBERS, [], []);

    expect(balances).toHaveLength(3);
    for (const b of balances) {
      expect(b.paid).toBe(0);
      expect(b.owed).toBe(0);
      expect(b.net).toBe(0);
    }
  });

  it("includes a member who has never participated in anything", () => {
    // A roommate who just joined must appear with a zero balance rather than
    // being invisible until their first expense.
    const balances = deriveBalances(MEMBERS, [equalExpense(MAYA, 30000, "e1")], []);
    expect(balances.map((b) => b.userId)).toEqual(MEMBERS);
  });

  it("credits the payer and debits every participant", () => {
    // Maya pays ₪300, split three ways: she is out ₪300 but owes ₪100, so she
    // is owed ₪200 by the other two.
    const balances = deriveBalances(MEMBERS, [equalExpense(MAYA, 30000, "e1")], []);

    expect(netOf(balances, MAYA)).toBe(20000);
    expect(netOf(balances, YONATAN)).toBe(-10000);
    expect(netOf(balances, NOA)).toBe(-10000);
    expect(balancesSumToZero(balances)).toBe(true);
  });

  it("reduces a debt when a settlement is recorded", () => {
    const expenses = [equalExpense(MAYA, 30000, "e1")];
    const settlements: LedgerSettlement[] = [
      { fromUser: YONATAN, toUser: MAYA, amountMinor: asMinor(10000) },
    ];

    const balances = deriveBalances(MEMBERS, expenses, settlements);

    expect(netOf(balances, YONATAN)).toBe(0); // fully settled
    expect(netOf(balances, MAYA)).toBe(10000); // still owed by Noa
    expect(balancesSumToZero(balances)).toBe(true);
  });

  it("supports partial settlements", () => {
    const balances = deriveBalances(
      MEMBERS,
      [equalExpense(MAYA, 30000, "e1")],
      [{ fromUser: YONATAN, toUser: MAYA, amountMinor: asMinor(4000) }],
    );

    expect(netOf(balances, YONATAN)).toBe(-6000);
    expect(netOf(balances, MAYA)).toBe(16000);
  });

  it("allows over-settlement to flip the direction of a debt", () => {
    // Paying more than you owe is legal — the UI warns, it does not block —
    // and the balance simply reverses.
    const balances = deriveBalances(
      MEMBERS,
      [equalExpense(MAYA, 30000, "e1")],
      [{ fromUser: YONATAN, toUser: MAYA, amountMinor: asMinor(15000) }],
    );

    expect(netOf(balances, YONATAN)).toBe(5000); // now owed money
    expect(balancesSumToZero(balances)).toBe(true);
  });

  it("excludes soft-deleted expenses", () => {
    const deleted = { ...equalExpense(MAYA, 30000, "e1"), isDeleted: true };
    const balances = deriveBalances(MEMBERS, [deleted], []);

    expect(balances.every((b) => b.net === 0)).toBe(true);
  });

  it("excludes voided settlements", () => {
    const balances = deriveBalances(
      MEMBERS,
      [equalExpense(MAYA, 30000, "e1")],
      [
        {
          fromUser: YONATAN,
          toUser: MAYA,
          amountMinor: asMinor(10000),
          isVoided: true,
        },
      ],
    );

    // The disputed payment must not clear the debt.
    expect(netOf(balances, YONATAN)).toBe(-10000);
  });

  it("handles an expense the payer is not part of", () => {
    // Fronting money for other people: Maya pays ₪200 for Yonatan and Noa only.
    const expense: LedgerExpense = {
      payerId: MAYA,
      amountMinor: asMinor(20000),
      splits: [
        { userId: YONATAN, shareMinor: asMinor(10000) },
        { userId: NOA, shareMinor: asMinor(10000) },
      ],
    };

    const balances = deriveBalances(MEMBERS, [expense], []);

    expect(netOf(balances, MAYA)).toBe(20000);
    expect(netOf(balances, YONATAN)).toBe(-10000);
    expect(balancesSumToZero(balances)).toBe(true);
  });

  it("ignores ledger rows belonging to non-members", () => {
    // Defensive: the database forbids this, but the function must still be
    // total rather than producing a phantom member row.
    const expense: LedgerExpense = {
      payerId: "stranger",
      amountMinor: asMinor(10000),
      splits: [{ userId: "stranger", shareMinor: asMinor(10000) }],
    };

    const balances = deriveBalances(MEMBERS, [expense], []);
    expect(balances).toHaveLength(3);
    expect(balances.every((b) => b.net === 0)).toBe(true);
  });

  it("ignores a settlement involving someone outside the household", () => {
    // Also defensive — the database blocks this via a membership trigger — but
    // a former member's settlement must not resurrect them in the balance list.
    const balances = deriveBalances(
      MEMBERS,
      [],
      [{ fromUser: "stranger", toUser: MAYA, amountMinor: asMinor(5000) }],
    );

    expect(balances).toHaveLength(3);
    expect(netOf(balances, MAYA)).toBe(-5000);
    expect(balances.some((b) => b.userId === "stranger")).toBe(false);
  });

  it("reproduces the seeded database scenario exactly", () => {
    // Mirrors supabase/seed.sql. If this test and the seed ever disagree, one
    // of them is wrong — and this is how we find out.
    const expenses: LedgerExpense[] = [
      {
        payerId: MAYA,
        amountMinor: asMinor(450000),
        splits: [
          { userId: MAYA, shareMinor: asMinor(150000) },
          { userId: YONATAN, shareMinor: asMinor(150000) },
          { userId: NOA, shareMinor: asMinor(150000) },
        ],
      },
      {
        payerId: YONATAN,
        amountMinor: asMinor(28750),
        splits: [
          { userId: MAYA, shareMinor: asMinor(9584) },
          { userId: YONATAN, shareMinor: asMinor(9583) },
          { userId: NOA, shareMinor: asMinor(9583) },
        ],
      },
      {
        payerId: NOA,
        amountMinor: asMinor(12990),
        splits: [
          { userId: MAYA, shareMinor: asMinor(4330) },
          { userId: YONATAN, shareMinor: asMinor(4330) },
          { userId: NOA, shareMinor: asMinor(4330) },
        ],
      },
      {
        payerId: MAYA,
        amountMinor: asMinor(34000),
        splits: [
          { userId: MAYA, shareMinor: asMinor(13600) },
          { userId: YONATAN, shareMinor: asMinor(10200) },
          { userId: NOA, shareMinor: asMinor(10200) },
        ],
      },
    ];

    const balances = deriveBalances(MEMBERS, expenses, [
      { fromUser: YONATAN, toUser: MAYA, amountMinor: asMinor(10000) },
    ]);

    expect(netOf(balances, MAYA)).toBe(296486);
    expect(netOf(balances, YONATAN)).toBe(-135363);
    expect(netOf(balances, NOA)).toBe(-161123);
    expect(balancesSumToZero(balances)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe("summariseFor", () => {
  it("describes being owed money", () => {
    const balances = deriveBalances(MEMBERS, [equalExpense(MAYA, 30000, "e1")], []);
    const summary = summariseFor(balances, MAYA);

    expect(summary.isOwed).toBe(true);
    expect(summary.owes).toBe(false);
    expect(summary.amount).toBe(20000);
  });

  it("describes owing money", () => {
    const balances = deriveBalances(MEMBERS, [equalExpense(MAYA, 30000, "e1")], []);
    const summary = summariseFor(balances, YONATAN);

    expect(summary.owes).toBe(true);
    // The magnitude is always positive; direction is carried by the flags, so
    // the UI never has to render a minus sign next to "you owe".
    expect(summary.amount).toBe(10000);
  });

  it("treats an unknown user as square rather than throwing", () => {
    const summary = summariseFor([], "nobody");
    expect(summary.net).toBe(0);
    expect(summary.isOwed).toBe(false);
    expect(summary.owes).toBe(false);
  });
});

describe("aggregateNet", () => {
  it("combines positions across households for the dashboard", () => {
    expect(aggregateNet([asMinor(20000), asMinor(-5000), asMinor(1500)])).toBe(16500);
    expect(aggregateNet([])).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("property: balances always sum to zero", () => {
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("holds for 500 randomly generated ledgers", () => {
    const random = mulberry32(13579);

    for (let run = 0; run < 500; run++) {
      const memberCount = 2 + Math.floor(random() * 6);
      const members = Array.from({ length: memberCount }, (_, i) => `m${i}`);

      const expenses: LedgerExpense[] = [];
      const expenseCount = Math.floor(random() * 12);

      for (let e = 0; e < expenseCount; e++) {
        const total = 1 + Math.floor(random() * 200000);
        const payer = members[Math.floor(random() * memberCount)] ?? members[0] ?? "m0";

        // A random non-empty subset of members participates.
        const participants = members.filter(() => random() > 0.3);
        if (participants.length === 0) continue;

        const split = computeSplits({
          totalMinor: asMinor(total),
          method: "equal",
          participants: participants.map((userId) => ({ userId })),
          seed: `run-${run}-exp-${e}`,
        });
        if (!split.ok) continue;

        expenses.push({
          payerId: payer,
          amountMinor: asMinor(total),
          splits: split.splits.map((s) => ({
            userId: s.userId,
            shareMinor: s.shareMinor,
          })),
          isDeleted: random() > 0.85,
        });
      }

      const settlements: LedgerSettlement[] = [];
      const settlementCount = Math.floor(random() * 4);
      for (let s = 0; s < settlementCount; s++) {
        const fromIndex = Math.floor(random() * memberCount);
        let toIndex = Math.floor(random() * memberCount);
        if (toIndex === fromIndex) toIndex = (toIndex + 1) % memberCount;

        settlements.push({
          fromUser: members[fromIndex] ?? "m0",
          toUser: members[toIndex] ?? "m1",
          amountMinor: asMinor(1 + Math.floor(random() * 50000)),
          isVoided: random() > 0.9,
        });
      }

      const balances = deriveBalances(members, expenses, settlements);
      expect(balancesSumToZero(balances)).toBe(true);
    }
  });
});
