/**
 * Debt simplification — turning a tangle of debts into the fewest transfers.
 * =============================================================================
 * THE PROBLEM
 * After a month of shared living, a four-person household typically owes money
 * in every direction. Settling each debt individually means many small
 * transfers, most of which cancel each other out.
 *
 *   Worked example (the one to use in the demo):
 *     A owes B ₪50, B owes C ₪50, C owes A ₪20.
 *
 *   Paid off literally, that is three separate payments. But netting the
 *   positions out gives A −30, B 0, C +30 — so the entire tangle collapses into
 *   ONE payment: A pays C ₪30. B, who is square, is not involved at all.
 *
 * THE ALGORITHM
 * Because balances already net out to zero, the problem reduces to: given a set
 * of debtors and a set of creditors, produce transfers that zero everyone.
 *
 *   1. Split members into debtors (net < 0) and creditors (net > 0).
 *   2. Repeatedly take the largest debtor and the largest creditor.
 *   3. Transfer min(|debt|, credit) between them.
 *   4. Whoever hits zero drops out; repeat until nobody is left.
 *
 * Each iteration zeroes at least one person, so with n members holding non-zero
 * balances the result is at most **n − 1 transfers**, versus up to n(n−1)/2 when
 * settling pairwise.
 *
 * THE HONEST CAVEAT
 * This is a greedy heuristic, not a proven optimum. Finding the genuinely
 * minimal number of transfers is NP-hard — it contains the subset-sum/partition
 * problem, since any subgroup whose balances happen to cancel could in principle
 * be settled among themselves. For household-sized groups the difference is
 * almost always zero, and the n−1 bound is guaranteed regardless. We document
 * the limitation rather than claiming optimality we cannot deliver.
 *
 * PROPERTIES GUARANTEED (and asserted in the test suite)
 *   • Total value is conserved: Σ transfers out = Σ transfers in.
 *   • Applying every transfer brings all net positions to exactly zero.
 *   • No member both sends and receives.
 *   • Every transfer amount is strictly positive.
 *   • At most n − 1 transfers.
 *   • Deterministic: the same balances always produce the same transfer list.
 */

import { asMinor, min as minMoney, type Minor } from "./money";

/** A member's net position: positive is owed money, negative owes money. */
export interface NetPosition {
  userId: string;
  net: Minor;
}

/** One suggested payment. */
export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountMinor: Minor;
}

/**
 * Computes the minimal-ish set of payments that clears every debt.
 *
 * @param positions Net positions, which must sum to zero (they always do when
 *                  they come from the ledger — see balances.ts).
 * @throws if the positions do not sum to zero, which would mean the ledger
 *         itself is corrupt. Producing "settlement suggestions" from broken
 *         input would silently move real money incorrectly, so this fails loudly.
 */
export function simplifyDebts(positions: readonly NetPosition[]): Transfer[] {
  const total = positions.reduce((acc, p) => acc + p.net, 0);
  if (total !== 0) {
    throw new Error(
      `Cannot simplify debts: net positions sum to ${total} instead of 0. ` +
        `This indicates a corrupt ledger.`,
    );
  }

  // Mutable working copies — the algorithm draws these balances down to zero.
  // `remaining` is annotated as a plain number rather than inheriting the
  // `Minor` brand: it is a running counter that is repeatedly decremented, and
  // branded values are meant to be immutable amounts. It is re-branded through
  // asMinor() at the point a real transfer amount is produced.
  //
  // Sorting is what makes the result deterministic; the userId tiebreak matters
  // when two members happen to owe exactly the same amount.
  interface Pending {
    userId: string;
    remaining: number;
  }

  const debtors: Pending[] = positions
    .filter((p) => p.net < 0)
    .map((p) => ({ userId: p.userId, remaining: -p.net }))
    .sort((a, b) => b.remaining - a.remaining || a.userId.localeCompare(b.userId));

  const creditors: Pending[] = positions
    .filter((p) => p.net > 0)
    .map((p) => ({ userId: p.userId, remaining: p.net as number }))
    .sort((a, b) => b.remaining - a.remaining || a.userId.localeCompare(b.userId));

  const transfers: Transfer[] = [];

  // Consuming the queues with shift() rather than indexing keeps the loop
  // condition and the "is anyone left?" question the same check, so there is no
  // separate bounds guard that can never actually fire.
  // Members with a zero balance were filtered out above and never participate.
  let debtor = debtors.shift();
  let creditor = creditors.shift();

  while (debtor && creditor) {
    // Move as much as possible in one payment. One of the two is necessarily
    // zeroed by this transfer, which is what bounds the loop at n − 1 iterations.
    const amount = minMoney(asMinor(debtor.remaining), asMinor(creditor.remaining));

    transfers.push({
      fromUserId: debtor.userId,
      toUserId: creditor.userId,
      amountMinor: amount,
    });

    debtor.remaining -= amount;
    creditor.remaining -= amount;

    if (debtor.remaining === 0) debtor = debtors.shift();
    if (creditor.remaining === 0) creditor = creditors.shift();
  }

  return transfers;
}

/**
 * The subset of transfers that involve a specific member.
 *
 * The settle-up screen leads with "what do I personally need to do", because
 * that is the only part a given user can act on. The full household view is
 * secondary.
 */
export function transfersInvolving(
  transfers: readonly Transfer[],
  userId: string,
): { outgoing: Transfer[]; incoming: Transfer[] } {
  return {
    outgoing: transfers.filter((t) => t.fromUserId === userId),
    incoming: transfers.filter((t) => t.toUserId === userId),
  };
}

/**
 * Applies a set of transfers to a set of positions, returning the resulting
 * positions.
 *
 * Exists for verification rather than for production use: the test suite
 * applies the suggested transfers and asserts that everyone lands on exactly
 * zero. Keeping this as a real function (instead of test-only code) means the
 * property can also be checked in the integration suite against database output.
 */
export function applyTransfers(
  positions: readonly NetPosition[],
  transfers: readonly Transfer[],
): NetPosition[] {
  const result = new Map<string, number>();
  for (const p of positions) result.set(p.userId, p.net);

  for (const t of transfers) {
    // Paying down a debt moves a negative balance towards zero.
    result.set(t.fromUserId, (result.get(t.fromUserId) ?? 0) + t.amountMinor);
    result.set(t.toUserId, (result.get(t.toUserId) ?? 0) - t.amountMinor);
  }

  return [...result.entries()].map(([userId, net]) => ({
    userId,
    net: asMinor(net),
  }));
}
