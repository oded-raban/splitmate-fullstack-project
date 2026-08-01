/**
 * Deriving each member's net position from the ledger.
 * =============================================================================
 * Balances are DERIVED, never stored. That is a deliberate architectural
 * decision (docs/02-architecture.md, ADR-2), and it is the reason SplitMate can
 * promise that a balance is never wrong:
 *
 *   A stored balance is a cache of financial truth. Every write path — create,
 *   edit, delete, restore, settle, void, the cron job — would have to update it
 *   correctly, forever, including in code nobody has written yet. One missed
 *   update produces a permanently wrong number with no way to detect it.
 *
 *   A derived balance is a pure function of an append-only ledger. It cannot
 *   drift, because there is nothing to drift from.
 *
 * THE FORMULA
 *     net = paid − owed + settlementsSent − settlementsReceived
 *
 *   paid                  what this member handed to merchants on the group's behalf
 *   owed                  the sum of their shares across all expenses
 *   settlementsSent       money they have since transferred to roommates
 *   settlementsReceived   money roommates have transferred to them
 *
 *   net > 0  →  the household owes them        ("you are owed ₪120")
 *   net < 0  →  they owe the household         ("you owe ₪120")
 *
 * INVARIANT: the nets of all members in a household always sum to exactly zero.
 * Every expense contributes +amount to one member and −amount spread across the
 * participants; every settlement contributes +x and −x. This is asserted in the
 * test suite against randomly generated ledgers, and it is the cheapest possible
 * check that the whole money pipeline is behaving.
 *
 * This module intentionally duplicates the logic of the SQL function
 * `get_household_balances`. The SQL version is what production reads (one round
 * trip, aggregation next to the data); this version exists so the rule can be
 * tested exhaustively without a database, and so the two implementations can be
 * cross-checked against each other in the integration suite.
 */

import { asMinor, type Minor, ZERO } from "./money";

/** One participant's obligation within an expense. */
export interface LedgerSplit {
  userId: string;
  shareMinor: Minor;
}

/** An expense as the balance calculation sees it. */
export interface LedgerExpense {
  payerId: string;
  amountMinor: Minor;
  splits: readonly LedgerSplit[];
  /** Soft-deleted expenses are excluded from balances but kept in history. */
  isDeleted?: boolean;
}

/** A recorded real-world payment between two members. */
export interface LedgerSettlement {
  fromUser: string;
  toUser: string;
  amountMinor: Minor;
  /** Voided settlements are disputed or mistaken and do not count. */
  isVoided?: boolean;
}

export interface MemberBalance {
  userId: string;
  paid: Minor;
  owed: Minor;
  settledOut: Minor;
  settledIn: Minor;
  /** Positive: owed money by the household. Negative: owes the household. */
  net: Minor;
}

/**
 * Computes every member's position.
 *
 * Members are passed in explicitly rather than inferred from the ledger so that
 * someone who has joined but not yet participated in anything still appears,
 * with a balance of zero. Inferring the member list would make new roommates
 * invisible until their first expense.
 */
export function deriveBalances(
  memberIds: readonly string[],
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
): MemberBalance[] {
  // One accumulator per member, keyed by user id and seeded from the member list
  // so that a Map lookup returning `undefined` means exactly one thing: this row
  // belongs to somebody who is not a member of the household. Such rows are
  // skipped rather than creating a phantom balance. (The database makes that
  // state impossible, but this function must be total for any input it is given.)
  interface Accumulator {
    paid: number;
    owed: number;
    settledOut: number;
    settledIn: number;
  }

  // Map preserves insertion order, so iterating it later yields members in the
  // order they were passed in — no separate ordering step needed.
  const totals = new Map<string, Accumulator>();
  for (const id of memberIds) {
    totals.set(id, { paid: 0, owed: 0, settledOut: 0, settledIn: 0 });
  }

  for (const expense of expenses) {
    if (expense.isDeleted) continue;

    const payer = totals.get(expense.payerId);
    if (payer) payer.paid += expense.amountMinor;

    for (const split of expense.splits) {
      const participant = totals.get(split.userId);
      if (participant) participant.owed += split.shareMinor;
    }
  }

  for (const settlement of settlements) {
    if (settlement.isVoided) continue;

    const sender = totals.get(settlement.fromUser);
    if (sender) sender.settledOut += settlement.amountMinor;

    const recipient = totals.get(settlement.toUser);
    if (recipient) recipient.settledIn += settlement.amountMinor;
  }

  return [...totals.entries()].map(([userId, t]) => ({
    userId,
    paid: asMinor(t.paid),
    owed: asMinor(t.owed),
    settledOut: asMinor(t.settledOut),
    settledIn: asMinor(t.settledIn),
    net: asMinor(t.paid - t.owed + t.settledOut - t.settledIn),
  }));
}

/**
 * The one-line summary shown at the top of every screen.
 *
 * Deliberately returns both figures separately rather than a single signed
 * number: "you are owed ₪300" and "you owe ₪300" are opposite emotional
 * messages, and the UI colours and words them differently.
 */
export function summariseFor(
  balances: readonly MemberBalance[],
  userId: string,
): { net: Minor; isOwed: boolean; owes: boolean; amount: Minor } {
  const mine = balances.find((b) => b.userId === userId);
  const net = mine?.net ?? ZERO;

  return {
    net,
    isOwed: net > 0,
    owes: net < 0,
    amount: asMinor(Math.abs(net)),
  };
}

/**
 * Aggregates a user's position across several households, for the dashboard.
 */
export function aggregateNet(nets: readonly Minor[]): Minor {
  return asMinor(nets.reduce((acc, value) => acc + value, 0));
}

/**
 * Verifies the zero-sum invariant.
 *
 * Exported so the integration tests can assert it against real database output,
 * not only against this module's own arithmetic. A non-zero result means either
 * an unbalanced expense reached the database (which the deferred trigger should
 * have made impossible) or the balance query is wrong — both are serious.
 */
export function balancesSumToZero(balances: readonly MemberBalance[]): boolean {
  return balances.reduce((acc, b) => acc + b.net, 0) === 0;
}
