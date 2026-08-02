/**
 * Presentation helpers for people and roles.
 * =============================================================================
 * A profile's display name is nullable: an account created by magic link has no
 * name until its owner sets one, and until then the member list would otherwise
 * show a blank row. Every place that renders a person goes through here so that
 * the fallback chain is decided once instead of drifting between screens.
 */

import { type HouseholdRole } from "@/lib/supabase/types";

export interface Nameable {
  displayName?: string | null;
  email?: string | null;
}

/**
 * The best available name for someone.
 *
 * Falls back to the local part of their email rather than the whole address:
 * "maya" identifies a roommate perfectly well, and printing full addresses
 * across a shared screen discloses more than the situation calls for.
 */
export function displayNameOf(person: Nameable, fallback = "Someone"): string {
  const name = person.displayName?.trim();
  if (name) return name;

  const email = person.email?.trim();
  if (email) return email.split("@")[0] ?? fallback;

  return fallback;
}

/** One or two letters for an avatar, derived from whatever name we have. */
export function initialsOf(person: Nameable): string {
  const name = displayNameOf(person, "");
  if (!name) return "?";

  const words = name.split(/[\s._-]+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";

  return (first + second).toUpperCase() || "?";
}

export const ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** What each role may do, shown next to the role selector so it is not a guess. */
export const ROLE_DESCRIPTIONS: Record<HouseholdRole, string> = {
  owner: "Full control, including deleting the household",
  admin: "Can invite, remove members and edit any expense",
  member: "Can add expenses and settle their own debts",
};
