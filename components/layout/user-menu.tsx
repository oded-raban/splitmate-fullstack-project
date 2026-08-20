"use client";

/**
 * Account menu.
 * =============================================================================
 * Sign-out is a <form> posting to a Server Action rather than an onClick that
 * calls the browser client. The session lives in an httpOnly cookie that the
 * browser cannot clear on its own, so ending it has to happen on the server —
 * and doing it through a form means it still works if this component never
 * hydrates.
 */

import Link from "next/link";
import { Bell, LogOut, User } from "lucide-react";

import { signOut } from "@/lib/actions/auth";
import { initialsOf, type Nameable } from "@/lib/display";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserMenuProps {
  person: Nameable & { avatarUrl?: string | null };
}

export function UserMenu({ person }: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          data-testid="user-menu"
          aria-label="Account menu"
        >
          <Avatar className="size-8">
            {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-xs">{initialsOf(person)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{person.displayName ?? "You"}</p>
          <p className="text-muted-foreground truncate text-xs">{person.email}</p>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/app/settings" className="gap-2">
            <User className="size-4" />
            Your profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/notifications" className="gap-2">
            <Bell className="size-4" />
            Notifications
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <form action={signOut}>
          <button
            type="submit"
            className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
