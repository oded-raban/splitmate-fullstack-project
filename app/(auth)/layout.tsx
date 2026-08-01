/**
 * Layout for the unauthenticated pages (login, invitation landing, auth errors).
 *
 * A route group — the `(auth)` folder does not appear in the URL, so this page
 * is served at `/login`, not `/auth/login`. The grouping exists purely so these
 * pages can share a layout that the signed-in application does not.
 */

import Link from "next/link";
import { Wallet } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
          <Wallet className="size-5" aria-hidden="true" />
        </span>
        SplitMate
      </Link>

      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
