/**
 * Translating database failures into things a person can read.
 * =============================================================================
 * A significant amount of this application's business logic lives in Postgres:
 * `create_household` rejects a blank name, `accept_invitation` rejects an
 * expired token, a deferred trigger rejects splits that do not sum to the total,
 * and RLS rejects a write to someone else's household. Every one of those
 * arrives at the Server Action as a `PostgrestError` — an object carrying a
 * five-character SQLSTATE and a message written for a developer.
 *
 * Passing those through to the UI would be wrong twice over. `new row violates
 * row-level security policy for table "expenses"` means nothing to a user and
 * leaks the schema to anyone probing the app.
 *
 * So the functions in our migrations raise with deliberate SQLSTATEs from the
 * user-defined `P0xxx` range and a `CODE: sentence` message, and this module is
 * the single place that turns the pair into an `ActionResult`. The convention is
 * worth stating plainly, because it only works if both halves keep it:
 *
 *     raise exception 'INVITE_EXPIRED: this invitation has expired'
 *       using errcode = 'P0006';
 *              │                    │
 *              │                    └── which category of failure
 *              └── message before the colon is a stable machine code,
 *                  after it is a sentence already fit to display
 *
 * Nothing here inspects `error.details` or `error.hint`, which are the fields
 * that contain table names, column names and row contents.
 */

import { fail, type ActionErrorCode, type ActionResult } from "@/lib/result";

/**
 * The shape both `postgrest-js` and `supabase-js` use for query and RPC errors.
 * Declared structurally rather than imported so that this module keeps working
 * if the client library reorganises its type exports.
 */
export interface DatabaseError {
  code?: string;
  message?: string;
}

/**
 * SQLSTATEs raised deliberately by our own functions, mapped to the action error
 * category the UI switches on. The `P0xxx` range is reserved by Postgres for
 * user-defined conditions, so none of these can collide with a built-in.
 */
const CUSTOM_SQLSTATES: Record<string, ActionErrorCode> = {
  P0004: "UNAUTHENTICATED",
  P0005: "VALIDATION",
  P0006: "BUSINESS_RULE", // invitation lifecycle
  P0007: "FORBIDDEN",
  P0001: "BUSINESS_RULE", // bare `raise exception` with no errcode
};

/** SQLSTATEs Postgres itself raises that have a meaningful user-facing reading. */
const BUILTIN_SQLSTATES: Record<string, { code: ActionErrorCode; message: string }> = {
  // Insufficient privilege. This is what an RLS policy rejection looks like, and
  // it is reported as "not found" rather than "forbidden" on purpose: telling
  // someone they lack permission on a specific row confirms that the row exists.
  "42501": {
    code: "NOT_FOUND",
    message: "That item no longer exists, or you don't have access to it.",
  },
  // Unique violation.
  "23505": {
    code: "CONFLICT",
    message: "That already exists.",
  },
  // Foreign key violation — referencing something that has since been deleted.
  "23503": {
    code: "NOT_FOUND",
    message: "Something this refers to no longer exists. Reload and try again.",
  },
  // Check constraint violation. The constraint name would identify the rule, but
  // it is a schema detail, so the message stays general.
  "23514": {
    code: "VALIDATION",
    message: "Those details aren't valid. Please check them and try again.",
  },
  // Not-null violation — a required value never reached the database.
  "23502": {
    code: "VALIDATION",
    message: "Something required was missing. Please check the form and try again.",
  },
  // Serialization failure / deadlock: genuinely transient, so say so.
  "40001": {
    code: "CONFLICT",
    message: "That clashed with another change. Please try again.",
  },
  "40P01": {
    code: "CONFLICT",
    message: "That clashed with another change. Please try again.",
  },
};

/**
 * Splits `'INVITE_EXPIRED: this invitation has expired'` into its machine code
 * and its display sentence. Messages that do not follow the convention (anything
 * Postgres itself raised) yield no code, and the caller falls back to a generic
 * message rather than showing raw database text.
 */
function parseRaisedMessage(message: string): { code?: string; sentence?: string } {
  const match = /^([A-Z][A-Z0-9_]{2,}):\s*(.+)$/s.exec(message.trim());
  if (!match?.[1] || !match[2]) return {};
  return { code: match[1], sentence: match[2] };
}

/** Sentence-cases a message that was written lower-case for a log line. */
function forDisplay(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * Converts a database error into a failed `ActionResult`.
 *
 * @param error    The error from a query or RPC call.
 * @param context  Short description of the attempted operation, for the server
 *                 log only. Never shown to the user.
 * @param overrides Display messages for specific raised codes, where the calling
 *                 action can phrase the failure better than the SQL function can
 *                 — the function has no idea which button was pressed.
 */
export function fromDatabaseError(
  error: DatabaseError,
  context: string,
  overrides: Partial<Record<string, string>> = {},
): ActionResult<never> {
  const sqlstate = error.code ?? "";
  const raw = error.message ?? "";
  const { code: raisedCode, sentence } = parseRaisedMessage(raw);

  const custom = CUSTOM_SQLSTATES[sqlstate];
  if (custom) {
    const override = raisedCode ? overrides[raisedCode] : undefined;
    const message =
      override ?? (sentence ? forDisplay(sentence) : "That isn't allowed.");
    return fail(custom, message);
  }

  const builtin = BUILTIN_SQLSTATES[sqlstate];
  if (builtin) {
    // Logged because a unique or check violation reaching this point usually
    // means a validation rule is missing upstream, not that the user misbehaved.
    console.warn(`[db] ${context}`, { sqlstate, message: raw });
    return fail(builtin.code, builtin.message);
  }

  // Anything unrecognised is a bug until proven otherwise: log it in full for
  // the server operator, and tell the user nothing about the internals.
  console.error(`[db] unhandled error during ${context}`, {
    sqlstate,
    message: raw,
  });
  return fail("UNKNOWN", "Something went wrong. Please try again.");
}

/**
 * The machine code from a raised exception, for the rare caller that needs to
 * branch on the specific failure rather than just report it.
 */
export function raisedCodeOf(error: DatabaseError): string | undefined {
  return parseRaisedMessage(error.message ?? "").code;
}
