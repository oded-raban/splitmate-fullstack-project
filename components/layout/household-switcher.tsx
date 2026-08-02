"use client";

/**
 * Household switcher.
 * =============================================================================
 * There is no "current household" stored anywhere — not in a cookie, not on the
 * profile. The household is the `[householdId]` segment of the URL, so switching
 * is an ordinary navigation and this component is a list of links.
 *
 * That choice pays off in several places at once: two households can be open in
 * two tabs without fighting over shared state, a link to a specific household is
 * meaningful when pasted to a roommate, and the back button behaves the way the
 * user expects because nothing changed except the address.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, Home, Plus } from "lucide-react";

import { type HouseholdSummary } from "@/lib/data/households";
import { ROLE_LABELS } from "@/lib/display";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HouseholdSwitcherProps {
  households: HouseholdSummary[];
}

export function HouseholdSwitcher({ households }: HouseholdSwitcherProps) {
  // Read from the URL rather than passed down, because the URL is already the
  // single source of truth for which household is open. Threading it through the
  // layout as a prop would create a second copy that could disagree with it.
  const activeId = /^\/app\/households\/([0-9a-f-]{36})/i.exec(usePathname())?.[1];
  const active = households.find((household) => household.id === activeId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 max-w-[14rem] gap-2 px-2 font-medium"
          data-testid="household-switcher"
        >
          <span className="truncate">{active ? active.name : "All households"}</span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem asChild>
          <Link href="/app" className="gap-2">
            <Home className="size-4" />
            <span className="flex-1">All households</span>
            {activeId ? null : <Check className="size-4" />}
          </Link>
        </DropdownMenuItem>

        {households.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Your households
            </DropdownMenuLabel>

            {households.map((household) => (
              <DropdownMenuItem key={household.id} asChild>
                <Link href={`/app/households/${household.id}`} className="gap-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{household.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {ROLE_LABELS[household.role]} ·{" "}
                      {household.memberCount === 1
                        ? "1 member"
                        : `${household.memberCount} members`}
                    </span>
                  </span>
                  {household.id === activeId ? <Check className="size-4" /> : null}
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding" className="gap-2">
            <Plus className="size-4" />
            New household
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
