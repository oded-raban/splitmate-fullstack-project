/**
 * CSV export of the household ledger.
 * =============================================================================
 * A route handler rather than a Server Action, because the response IS the file.
 * A Server Action returns a value to a React tree; it has no way to set
 * Content-Disposition, which is what makes a browser save this instead of trying
 * to render it.
 *
 * WHY THIS EXISTS
 * A shared ledger people cannot get their own data out of is a hostage.
 * Someone moving out wants the year's records; someone doing their taxes
 * wants the utilities. Both should be able to leave with what they put in.
 *
 * WHY IT READS WITH THE USER'S OWN CLIENT
 * The obvious shortcut — the service-role key, since this is "just a read" —
 * would bypass RLS entirely and make this endpoint the one place in the
 * application where household isolation depends on the correctness of a line of
 * TypeScript. Using the caller's session means the same policies that protect
 * every page protect the export, and a bug here yields an empty file rather than
 * somebody else's finances.
 */

import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth";
import { csvFilename, toCsv } from "@/lib/domain/csv";
import { asMinor, formatAmount } from "@/lib/domain/money";
import { createClient } from "@/lib/supabase/server";

/** Guards against a request that would try to serialise an entire history. */
const MAX_ROWS = 5000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ householdId: string }> },
) {
  const { householdId } = await params;

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to export" }, { status: 401 });
  }

  const supabase = await createClient();

  // Membership is checked explicitly here even though RLS would filter the rows
  // anyway. Without it a non-member receives a valid, empty CSV and no
  // indication of why — and, more importantly, learns that the household id is
  // real. A 404 says nothing either way.
  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("household_id", householdId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!isDate(from) || !isDate(to)) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const [household, expenses, profiles] = await Promise.all([
    supabase.from("households").select("name, currency").eq("id", householdId).single(),
    supabase
      .from("expenses")
      .select(
        `id, description, amount_minor, spent_at, payer_id, split_method, note,
         categories ( name ),
         expense_splits ( user_id, share_minor )`,
      )
      .eq("household_id", householdId)
      .is("deleted_at", null)
      .gte("spent_at", from)
      .lte("spent_at", to)
      .order("spent_at", { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from("household_members")
      .select("user_id, profiles ( display_name, email )")
      .eq("household_id", householdId),
  ]);

  if (household.error || expenses.error) {
    console.error(
      "[export] query failed",
      household.error?.message ?? expenses.error?.message,
    );
    return NextResponse.json({ error: "Could not build the export" }, { status: 500 });
  }

  const nameOf = new Map(
    (profiles.data ?? []).map((row) => [
      row.user_id,
      row.profiles?.display_name || row.profiles?.email || "Unknown",
    ]),
  );

  // One row per expense with a "your share" column, rather than one row per
  // split. A spreadsheet of splits is the normalised shape and nobody can read
  // it; this is the shape a person opens and immediately understands.
  const rows: unknown[][] = [
    [
      "Date",
      "Description",
      "Category",
      "Paid by",
      `Amount (${household.data.currency})`,
      `Your share (${household.data.currency})`,
      "Split method",
      "Note",
    ],
  ];

  for (const expense of expenses.data ?? []) {
    const mine = expense.expense_splits.find((split) => split.user_id === user.id);

    rows.push([
      expense.spent_at,
      expense.description,
      expense.categories?.name ?? "Uncategorised",
      nameOf.get(expense.payer_id) ?? "A former member",
      // Plain decimal, not `formatMoney`. A currency symbol and thousands
      // separators would make every amount a text cell that a spreadsheet
      // refuses to sum, which defeats the reason to export at all.
      formatAmount(asMinor(expense.amount_minor)),
      mine ? formatAmount(asMinor(mine.share_minor)) : "0.00",
      expense.split_method,
      expense.note ?? "",
    ]);
  }

  // The BOM is what makes Excel read this as UTF-8. Without it, Excel on a
  // Windows locale interprets the bytes as the system codepage and every
  // non-ASCII name in the household comes out as mojibake.
  const body = `\uFEFF${toCsv(rows)}`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename(household.data.name, from, to)}"`,
      // Contains one member's personal financial history, so no shared cache may
      // keep a copy that could be served to the next person through the CDN.
      "Cache-Control": "private, no-store",
    },
  });
}
