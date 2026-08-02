/**
 * Reads for the expense ledger, balances and settlements.
 * =============================================================================
 * As with lib/data/households.ts, every query runs through the RLS-constrained
 * client, so a household id the caller has no right to produces an empty result
 * from Postgres rather than a filtered one from us.
 *
 * PAGINATION IS BY CURSOR, NOT OFFSET.
 * `OFFSET 900` makes Postgres walk and discard 900 rows, so a page deep in the
 * history costs more than a page near the top, and the cost grows with the
 * ledger. Worse, an expense added while someone is paging shifts every
 * subsequent row down by one, so a row is silently skipped. Seeking on
 * `(spent_at, id) < (cursor)` uses the index directly, costs the same at any
 * depth, and cannot skip or repeat a row.
 */

import { cache } from "react";

import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { asMinor, type Minor } from "@/lib/domain/money";
import { type SplitMethod } from "@/lib/domain/splits";
import { type SettlementMethod } from "@/lib/supabase/types";

export interface ExpenseSplitDetail {
  userId: string;
  shareMinor: Minor;
  shareInput: number | null;
}

export interface ExpenseListItem {
  id: string;
  description: string;
  amountMinor: Minor;
  spentAt: string;
  payerId: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  splitMethod: SplitMethod;
  receiptPath: string | null;
  createdAt: string;
  /** The viewer's own share, or null when they are not a participant. */
  viewerShareMinor: Minor | null;
}

export interface ExpenseDetail extends ExpenseListItem {
  note: string | null;
  updatedAt: string;
  createdBy: string;
  splits: ExpenseSplitDetail[];
}

export interface ExpensePage {
  items: ExpenseListItem[];
  /** Opaque cursor for the next page, or null when the ledger is exhausted. */
  nextCursor: string | null;
}

export interface CategoryOption {
  id: string;
  name: string;
  icon: string | null;
}

export interface BalanceRow {
  userId: string;
  paid: Minor;
  owed: Minor;
  settledOut: Minor;
  settledIn: Minor;
  net: Minor;
}

export interface SettlementRow {
  id: string;
  fromUser: string;
  toUser: string;
  amountMinor: Minor;
  method: SettlementMethod;
  note: string | null;
  settledAt: string;
  voidedAt: string | null;
}

/** How many expenses one page of history holds. */
export const PAGE_SIZE = 20;

/**
 * Encodes the sort key of the last row on a page.
 *
 * Both components are needed because `spent_at` is a date: several expenses
 * routinely share one, and a cursor on the date alone could not say which of
 * them the page ended on. The id breaks that tie, and because it is also part of
 * the ordering the pair is unique.
 */
function encodeCursor(spentAt: string, id: string): string {
  return Buffer.from(`${spentAt}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { spentAt: string; id: string } | null {
  try {
    const [spentAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!spentAt || !id) return null;
    return { spentAt, id };
  } catch {
    return null;
  }
}

/**
 * One page of a household's expense history, newest first.
 *
 * Soft-deleted rows are excluded here rather than in the caller: a deleted
 * expense stays in the table so history and audit remain intact, but it is not
 * part of the ledger any more and must not appear in a list or a balance.
 */
export async function getExpenses(
  householdId: string,
  options: { cursor?: string | null; categoryId?: string | null } = {},
): Promise<ExpensePage> {
  const user = await getUser();
  if (!user) return { items: [], nextCursor: null };

  const supabase = await createClient();

  let query = supabase
    .from("expenses")
    .select(
      `id, description, amount_minor, spent_at, payer_id, category_id,
       split_method, receipt_path, created_at,
       categories ( name, icon ),
       expense_splits ( user_id, share_minor )`,
    )
    .eq("household_id", householdId)
    .is("deleted_at", null)
    .order("spent_at", { ascending: false })
    .order("id", { ascending: false })
    // One extra row is fetched purely to answer "is there another page?" without
    // a second COUNT query, which on a large ledger would cost as much as the
    // page itself. The extra row is dropped before returning.
    .limit(PAGE_SIZE + 1);

  if (options.categoryId) {
    query = query.eq("category_id", options.categoryId);
  }

  const position = options.cursor ? decodeCursor(options.cursor) : null;
  if (position) {
    // PostgREST has no tuple comparison, so the row-wise `(spent_at, id) < (a, b)`
    // is spelled out: strictly earlier days, or the same day with a lower id.
    query = query.or(
      `spent_at.lt.${position.spentAt},` +
        `and(spent_at.eq.${position.spentAt},id.lt.${position.id})`,
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("[data] getExpenses failed", error.message);
    return { items: [], nextCursor: null };
  }

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const items: ExpenseListItem[] = page.map((row) => {
    const mine = row.expense_splits.find((split) => split.user_id === user.id);

    return {
      id: row.id,
      description: row.description,
      amountMinor: asMinor(row.amount_minor),
      spentAt: row.spent_at,
      payerId: row.payer_id,
      categoryId: row.category_id,
      categoryName: row.categories?.name ?? null,
      categoryIcon: row.categories?.icon ?? null,
      splitMethod: row.split_method,
      receiptPath: row.receipt_path,
      createdAt: row.created_at,
      viewerShareMinor: mine ? asMinor(mine.share_minor) : null,
    };
  });

  const last = page[page.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.spent_at, last.id) : null,
  };
}

/**
 * A single expense with its full split set, for the edit form and detail view.
 *
 * Returns null when the row is invisible, so the caller renders a 404 that looks
 * identical whether the expense belongs to another household or does not exist.
 */
export async function getExpense(
  householdId: string,
  expenseId: string,
): Promise<ExpenseDetail | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select(
      `id, description, amount_minor, spent_at, payer_id, category_id, note,
       split_method, receipt_path, created_at, updated_at, created_by,
       categories ( name, icon ),
       expense_splits ( user_id, share_minor, share_input )`,
    )
    .eq("household_id", householdId)
    .eq("id", expenseId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[data] getExpense failed", error.message);
    return null;
  }

  const splits = data.expense_splits.map((split) => ({
    userId: split.user_id,
    shareMinor: asMinor(split.share_minor),
    shareInput: split.share_input === null ? null : Number(split.share_input),
  }));

  return {
    id: data.id,
    description: data.description,
    amountMinor: asMinor(data.amount_minor),
    spentAt: data.spent_at,
    payerId: data.payer_id,
    categoryId: data.category_id,
    categoryName: data.categories?.name ?? null,
    categoryIcon: data.categories?.icon ?? null,
    splitMethod: data.split_method,
    receiptPath: data.receipt_path,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    createdBy: data.created_by,
    note: data.note,
    splits,
    viewerShareMinor:
      splits.find((split) => split.userId === user.id)?.shareMinor ?? null,
  };
}

/**
 * Every member's position, computed by Postgres.
 *
 * The aggregation runs in the database rather than in Node deliberately: summing
 * in the application would mean transferring every expense and every split over
 * the wire on each page load, so the cost of rendering a balance would grow with
 * the size of the ledger instead of with the number of members.
 */
export const getBalances = cache(async (householdId: string): Promise<BalanceRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_household_balances", {
    p_household_id: householdId,
  });

  if (error) {
    console.error("[data] getBalances failed", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    paid: asMinor(row.paid),
    owed: asMinor(row.owed),
    settledOut: asMinor(row.settled_out),
    settledIn: asMinor(row.settled_in),
    net: asMinor(row.net),
  }));
});

/** Recorded payments between members, newest first. */
export async function getSettlements(
  householdId: string,
  limit = 20,
): Promise<SettlementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settlements")
    .select("id, from_user, to_user, amount_minor, method, note, settled_at, voided_at")
    .eq("household_id", householdId)
    .order("settled_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[data] getSettlements failed", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    fromUser: row.from_user,
    toUser: row.to_user,
    amountMinor: asMinor(row.amount_minor),
    method: row.method,
    note: row.note,
    settledAt: row.settled_at,
    voidedAt: row.voided_at,
  }));
}

/** The household's categories, for the expense form's picker. */
export const getCategories = cache(
  async (householdId: string): Promise<CategoryOption[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, icon")
      .eq("household_id", householdId)
      .order("name", { ascending: true });

    if (error) {
      console.error("[data] getCategories failed", error.message);
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      icon: row.icon,
    }));
  },
);
