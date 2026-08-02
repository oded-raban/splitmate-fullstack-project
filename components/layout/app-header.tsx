/**
 * Header for every signed-in page.
 * =============================================================================
 * A Server Component: it needs the user's households and profile, and fetching
 * those on the server means the header arrives already populated instead of
 * flashing an empty switcher while a client request resolves.
 *
 * Only the two pieces that genuinely need interactivity — the switcher dropdown
 * and the account menu — are Client Components, so the JavaScript sent for the
 * chrome of the app stays proportional to the chrome that actually does
 * something.
 */

import Link from "next/link";
import { Wallet } from "lucide-react";

import { getProfile } from "@/lib/auth";
import { getHouseholdsForUser } from "@/lib/data/households";
import { HouseholdSwitcher } from "@/components/layout/household-switcher";
import { UserMenu } from "@/components/layout/user-menu";

export async function AppHeader() {
  const [households, profile] = await Promise.all([
    getHouseholdsForUser(),
    getProfile(),
  ]);

  return (
    <header className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
        <Link
          href="/app"
          className="flex items-center gap-2 font-semibold"
          aria-label="SplitMate home"
        >
          <span className="bg-foreground text-background flex size-7 items-center justify-center rounded-md">
            <Wallet className="size-4" aria-hidden="true" />
          </span>
          <span className="hidden sm:inline">SplitMate</span>
        </Link>

        <span className="text-muted-foreground/40" aria-hidden="true">
          /
        </span>

        <HouseholdSwitcher households={households} />

        <div className="ml-auto">
          <UserMenu
            person={{
              displayName: profile?.display_name ?? null,
              email: profile?.email ?? null,
              avatarUrl: profile?.avatar_url ?? null,
            }}
          />
        </div>
      </div>
    </header>
  );
}
