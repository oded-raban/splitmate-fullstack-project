/**
 * The return contract for every Server Action.
 * =============================================================================
 * WHY ACTIONS RETURN ERRORS INSTEAD OF THROWING THEM
 *
 * A Server Action is not a function call — it is a network round trip that
 * happens to look like one. An exception thrown on the server does not arrive
 * on the client as an exception: in production React replaces the message with
 * a generic "An error occurred in the Server Components render" and a digest
 * hash, precisely so that internal details (table names, constraint names,
 * stack traces) cannot leak to a user.
 *
 * That is correct behaviour for a *bug*, and useless for an *expected outcome*.
 * "Percentages must add up to 100%" and "someone else edited this expense" are
 * things the user needs to read and act on, not incidents to be hidden.
 *
 * So the rule in this codebase is:
 *
 *   • Expected outcomes  → returned as `ActionResult`, rendered in the form.
 *   • Genuine bugs       → thrown, caught by an error boundary, reported to
 *                          Sentry, and shown to the user as a generic apology.
 *
 * The discriminated union means TypeScript forces the caller to handle the
 * failure case before it can reach `result.data` — you cannot accidentally
 * render an undefined value on the unhappy path.
 */

/** Machine-readable failure codes. The UI switches on these, never on strings. */
export type ActionErrorCode =
  /** Not signed in, or the session expired mid-action. */
  | "UNAUTHENTICATED"
  /** Signed in, but not allowed to do this. */
  | "FORBIDDEN"
  /** The thing being acted on does not exist (or is invisible to this user). */
  | "NOT_FOUND"
  /** Input failed schema validation. `fieldErrors` carries the details. */
  | "VALIDATION"
  /** Someone else changed the record first (optimistic concurrency). */
  | "CONFLICT"
  /** A domain rule was broken, e.g. splits that do not balance. */
  | "BUSINESS_RULE"
  /** Too many attempts. */
  | "RATE_LIMITED"
  /** Anything unanticipated. The message is deliberately generic. */
  | "UNKNOWN";

export interface ActionError {
  code: ActionErrorCode;
  /** Safe to render directly to the user. Never contains internal detail. */
  message: string;
  /**
   * Per-field messages, keyed by form field name, so react-hook-form can
   * attach each one to the input that caused it rather than dumping a single
   * error at the top of the form.
   */
  fieldErrors?: Record<string, string[]>;
}

export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: ActionError };

/* -------------------------------------------------------------------------- */
/* Constructors                                                                */
/* -------------------------------------------------------------------------- */

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(
  code: ActionErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  return {
    ok: false,
    error: fieldErrors ? { code, message, fieldErrors } : { code, message },
  };
}

/** Convenience for the most common failures, so their wording stays consistent. */
export const failures = {
  unauthenticated: () => fail("UNAUTHENTICATED", "Please sign in to continue."),

  forbidden: (what = "do that") =>
    fail("FORBIDDEN", `You don't have permission to ${what}.`),

  notFound: (what = "That item") => fail("NOT_FOUND", `${what} no longer exists.`),

  conflict: () =>
    fail(
      "CONFLICT",
      "Someone else changed this while you were editing. Reload to see the latest version.",
    ),

  unknown: () => fail("UNKNOWN", "Something went wrong. Please try again."),
} as const;

/**
 * The idle state for `useActionState`, so a form starts with a value of the
 * right shape rather than with `null` that every consumer has to guard against.
 */
export const idleResult = { ok: true, data: undefined } as ActionResult<undefined>;
