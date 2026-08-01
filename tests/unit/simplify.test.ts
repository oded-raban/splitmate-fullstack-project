/**
 * Unit tests — debt simplification.
 *
 * The algorithm is a greedy heuristic, so these tests deliberately assert the
 * properties it *guarantees* (value is conserved, everyone lands on zero, at
 * most n−1 transfers, no member both sends and receives) rather than asserting
 * a specific transfer list for arbitrary input. Where the optimum is obvious —
 * the circular-debt example from the design docs — the exact result is checked.
 */

import { describe, expect, it } from "vitest";
import { asMinor } from "@/lib/domain/money";
import {
  applyTransfers,
  simplifyDebts,
  transfersInvolving,
  type NetPosition,
} from "@/lib/domain/simplify";

function positions(entries: Record<string, number>): NetPosition[] {
  return Object.entries(entries).map(([userId, net]) => ({
    userId,
    net: asMinor(net),
  }));
}

function totalTransferred(transfers: ReturnType<typeof simplifyDebts>): number {
  return transfers.reduce((acc, t) => acc + t.amountMinor, 0);
}

/* -------------------------------------------------------------------------- */

describe("simplifyDebts", () => {
  it("returns nothing when everyone is square", () => {
    expect(simplifyDebts(positions({ a: 0, b: 0, c: 0 }))).toEqual([]);
    expect(simplifyDebts([])).toEqual([]);
  });

  it("handles the simplest case: one debtor, one creditor", () => {
    const transfers = simplifyDebts(positions({ maya: 10000, yonatan: -10000 }));

    expect(transfers).toEqual([
      { fromUserId: "yonatan", toUserId: "maya", amountMinor: 10000 },
    ]);
  });

  it("collapses circular debt into a single payment", () => {
    // The worked example from docs/03-technical-spec.md §6.3:
    //   A owes B ₪50, B owes C ₪50, C owes A ₪20.
    // Settled literally that is three payments; netted out it is one.
    const transfers = simplifyDebts(positions({ a: -3000, b: 0, c: 3000 }));

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toEqual({
      fromUserId: "a",
      toUserId: "c",
      amountMinor: 3000,
    });
    // B is square and must not appear at all.
    expect(transfers.some((t) => t.fromUserId === "b" || t.toUserId === "b")).toBe(
      false,
    );
  });

  it("splits one debtor across several creditors", () => {
    const transfers = simplifyDebts(positions({ debtor: -30000, a: 20000, b: 10000 }));

    expect(transfers).toHaveLength(2);
    expect(totalTransferred(transfers)).toBe(30000);
    expect(transfers.every((t) => t.fromUserId === "debtor")).toBe(true);
  });

  it("uses at most n − 1 transfers", () => {
    // Five members with non-zero balances → never more than four payments,
    // versus up to ten if every pair settled directly.
    const p = positions({ a: 5000, b: 3000, c: -2000, d: -4000, e: -2000 });
    const transfers = simplifyDebts(p);

    expect(transfers.length).toBeLessThanOrEqual(p.length - 1);
  });

  it("never makes a member both send and receive", () => {
    const transfers = simplifyDebts(
      positions({ a: 12000, b: -5000, c: -3000, d: -4000 }),
    );

    const senders = new Set(transfers.map((t) => t.fromUserId));
    const receivers = new Set(transfers.map((t) => t.toUserId));

    for (const sender of senders) expect(receivers.has(sender)).toBe(false);
  });

  it("only produces positive amounts", () => {
    const transfers = simplifyDebts(
      positions({ a: 7500, b: -2500, c: -2500, d: -2500 }),
    );
    expect(transfers.every((t) => t.amountMinor > 0)).toBe(true);
  });

  it("is deterministic", () => {
    const p = positions({ a: 5000, b: 3000, c: -4000, d: -4000 });
    expect(simplifyDebts(p)).toEqual(simplifyDebts(p));
  });

  it("refuses to work from a corrupt ledger", () => {
    // Positions that do not sum to zero mean the ledger itself is broken.
    // Producing "suggestions" from that would move real money incorrectly, so
    // this must fail loudly rather than guess.
    expect(() => simplifyDebts(positions({ a: 100, b: -50 }))).toThrow(/sum to/i);
  });
});

/* -------------------------------------------------------------------------- */

describe("applyTransfers", () => {
  it("brings every position to exactly zero", () => {
    const p = positions({ a: 12345, b: -4321, c: -8024 });
    const settled = applyTransfers(p, simplifyDebts(p));

    expect(settled.every((entry) => entry.net === 0)).toBe(true);
  });

  it("accounts for a transfer involving someone not in the original set", () => {
    // Defensive path: a member could in principle be removed between computing
    // the balances and applying the transfers. They should appear in the result
    // rather than being silently dropped, so the totals still reconcile.
    const result = applyTransfers(positions({ a: 0 }), [
      { fromUserId: "ghost", toUserId: "a", amountMinor: asMinor(500) },
    ]);

    expect(result).toContainEqual({ userId: "ghost", net: 500 });
    expect(result).toContainEqual({ userId: "a", net: -500 });
  });

  it("conserves total value", () => {
    const p = positions({ a: 9000, b: 1000, c: -6000, d: -4000 });
    const transfers = simplifyDebts(p);

    const out = transfers.reduce((acc, t) => acc + t.amountMinor, 0);
    const owedTotal = p.filter((x) => x.net > 0).reduce((acc, x) => acc + x.net, 0);

    expect(out).toBe(owedTotal);
  });
});

/* -------------------------------------------------------------------------- */

describe("transfersInvolving", () => {
  it("separates what a member must pay from what they will receive", () => {
    const transfers = simplifyDebts(positions({ a: 10000, b: -6000, c: -4000 }));

    const forB = transfersInvolving(transfers, "b");
    expect(forB.outgoing).toHaveLength(1);
    expect(forB.incoming).toHaveLength(0);

    const forA = transfersInvolving(transfers, "a");
    expect(forA.incoming).toHaveLength(2);
    expect(forA.outgoing).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("property: simplification always settles the household", () => {
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("holds for 1000 random zero-sum balance sets", () => {
    const random = mulberry32(24680);

    for (let run = 0; run < 1000; run++) {
      const count = 2 + Math.floor(random() * 7);

      // Build a guaranteed zero-sum set: assign random values to everyone but
      // the last member, who absorbs the negation of the rest.
      const values: number[] = [];
      let running = 0;
      for (let i = 0; i < count - 1; i++) {
        const value = Math.floor(random() * 200000) - 100000;
        values.push(value);
        running += value;
      }
      values.push(-running);

      const p: NetPosition[] = values.map((net, i) => ({
        userId: `m${i}`,
        net: asMinor(net),
      }));

      const transfers = simplifyDebts(p);

      // 1. Everyone ends at zero.
      const settled = applyTransfers(p, transfers);
      expect(settled.every((entry) => entry.net === 0)).toBe(true);

      // 2. At most n − 1 transfers.
      const nonZero = p.filter((entry) => entry.net !== 0).length;
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));

      // 3. All amounts positive.
      expect(transfers.every((t) => t.amountMinor > 0)).toBe(true);

      // 4. Nobody both sends and receives.
      const senders = new Set(transfers.map((t) => t.fromUserId));
      for (const t of transfers) expect(senders.has(t.toUserId)).toBe(false);
    }
  });
});
