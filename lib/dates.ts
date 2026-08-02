/**
 * Calendar dates in a household's timezone.
 * =============================================================================
 * An expense belongs to a DAY, not to an instant. Which day depends on where the
 * household is, not on where the person recording it happens to be standing —
 * a roommate filing the electricity bill from a different timezone should not
 * file it against yesterday.
 *
 * Deriving this on the server also removes a hydration hazard: `new Date()` in a
 * component produces one answer during server rendering and another in the
 * browser, and either side of midnight those answers differ.
 */

/**
 * Today's date in `timezone`, as `YYYY-MM-DD`.
 *
 * `en-CA` is not arbitrary: its short date format is already ISO-ordered, so the
 * parts come back in the order the value needs to be in. Assembling the string
 * from `formatToParts` would work too and reads worse.
 */
export function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // An unknown timezone must not take the page down. UTC is a defensible
    // fallback, and the user can still change the date by hand.
    return new Date().toISOString().slice(0, 10);
  }
}
