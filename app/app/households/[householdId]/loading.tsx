/**
 * Streaming placeholder for the household workspace.
 * =============================================================================
 * Next renders this the moment navigation starts, while the page's queries are
 * still running, so a switch between households feels immediate instead of
 * leaving the previous screen frozen under a spinner.
 *
 * The skeleton mirrors the real layout — a header line, then cards of roughly
 * the right height — because a placeholder that does not match causes the page
 * to jump when content replaces it, which reads as slower than no placeholder at
 * all even though it is faster.
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function HouseholdLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading household">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
