"use client";

/**
 * Tab bar for a household workspace.
 * =============================================================================
 * The active tab is derived from the pathname rather than held in state. There
 * is nothing to keep in sync, nothing to reset on navigation, and a tab is still
 * highlighted correctly on a cold load of a deep link — which state would not
 * survive.
 *
 * Tabs are rendered from the viewer's role rather than rendered and disabled:
 * showing a Settings tab that refuses to open teaches nothing except that the
 * app is unpredictable.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { type HouseholdRole } from "@/lib/supabase/types";

interface HouseholdNavProps {
  householdId: string;
  role: HouseholdRole;
}

const TABS = [
  { segment: "", label: "Home" },
  { segment: "expenses", label: "Expenses" },
  { segment: "settle", label: "Settle up" },
  { segment: "shopping", label: "Shopping" },
  { segment: "members", label: "Members" },
  { segment: "settings", label: "Settings", managersOnly: true },
] as const;

export function HouseholdNav({ householdId, role }: HouseholdNavProps) {
  const pathname = usePathname();
  const base = `/app/households/${householdId}`;
  const canManage = role === "owner" || role === "admin";

  return (
    <nav
      aria-label="Household sections"
      className="border-border -mb-px flex gap-1 overflow-x-auto border-b"
    >
      {TABS.filter(
        (tab) => !("managersOnly" in tab && tab.managersOnly) || canManage,
      ).map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        // Compared exactly for Home so that every sub-route does not light it
        // up, and by prefix elsewhere so `/expenses/new` keeps Expenses active.
        const isActive = tab.segment
          ? pathname === href || pathname.startsWith(`${href}/`)
          : pathname === href;

        return (
          <Link
            key={tab.label}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              isActive
                ? "border-foreground text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
