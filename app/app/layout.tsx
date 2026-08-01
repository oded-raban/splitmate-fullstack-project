/**
 * Shell for every signed-in page.
 * =============================================================================
 * `requireUser()` here is the second of three independent checks:
 *
 *   1. proxy.ts redirects a request with no session (fast, but bypassable —
 *      a Server Action invoked directly never passes through it)
 *   2. this layout, which guarantees no signed-in page ever renders without a
 *      verified user, so no child component has to defend itself
 *   3. Row Level Security in the database, which is the boundary that actually
 *      matters and holds even if 1 and 2 are both wrong
 *
 * The redundancy is intentional. Each layer exists for a different reason: the
 * first for speed, the second for developer ergonomics, the third for security.
 */

import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser("/app");

  return <div className="flex min-h-svh flex-col">{children}</div>;
}
