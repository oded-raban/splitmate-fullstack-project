/**
 * Relative timestamps.
 * =============================================================================
 * "joined 3 minutes ago" is more useful than a date, and it is also the classic
 * source of a hydration mismatch: the string depends on the clock, and the two
 * renders that React compares do not happen at the same instant. Cross a minute
 * boundary between them and the server says "3 minutes ago" while the client
 * says "4", which React reports as a mismatch and repairs by discarding the
 * server's HTML for that subtree.
 *
 * `suppressHydrationWarning` is the correct tool here rather than a workaround.
 * It tells React that a difference in this node's text is expected and should be
 * accepted rather than treated as a bug — which is exactly true of a value
 * derived from `now`.
 *
 * The underlying instant is preserved in `dateTime` and spelled out in the
 * tooltip, so the exact moment is never actually lost to the rounding.
 */

import { format, formatDistanceToNow } from "date-fns";

interface TimeAgoProps {
  /** An ISO 8601 timestamp, as returned by Postgres `timestamptz` columns. */
  value: string;
  className?: string;
}

/**
 * Handles both directions: `addSuffix` renders "3 minutes ago" for a past
 * instant and "in 7 days" for a future one, so a deadline needs no separate
 * component and no caller has to prepend its own preposition.
 */
export function TimeAgo({ value, className }: TimeAgoProps) {
  const date = new Date(value);

  return (
    <time
      dateTime={date.toISOString()}
      title={format(date, "d MMM yyyy, HH:mm")}
      suppressHydrationWarning
      className={className}
    >
      {formatDistanceToNow(date, { addSuffix: true })}
    </time>
  );
}
