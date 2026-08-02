/**
 * Reads for households, members and invitations.
 * =============================================================================
 * Plain async functions called directly from Server Components. There is no
 * fetch, no client-side cache and no serialisation step: the component awaits
 * the query and renders the rows.
 *
 * Every function here goes through the RLS-constrained client, so authorization
 * is not something these functions perform — it is something they cannot avoid.
 * A caller who passes a household id they have no business seeing gets an empty
 * result from the database, not a filtered one from us.
 */

import { cache } from "react";

import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type HouseholdRole } from "@/lib/supabase/types";

export interface HouseholdSummary {
  id: string;
  name: string;
  currency: string;
  role: HouseholdRole;
  memberCount: number;
  joinedAt: string;
}

export interface MemberDetail {
  userId: string;
  role: HouseholdRole;
  joinedAt: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  isViewer: boolean;
}

export interface HouseholdDetail {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  createdAt: string;
  members: MemberDetail[];
  viewerRole: HouseholdRole;
}

export interface PendingInvitation {
  id: string;
  email: string | null;
  role: HouseholdRole;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
}

/** Orders owner first, then admins, then members — the order people expect. */
const ROLE_RANK: Record<HouseholdRole, number> = { owner: 0, admin: 1, member: 2 };

/**
 * Every household the signed-in user belongs to, for the switcher and the
 * cross-household dashboard.
 *
 * The nested select is one round trip rather than two: PostgREST resolves the
 * `households` relationship through the foreign key, and the embedded
 * `household_members(count)` gives the member tally without a second query per
 * row. Archived households are excluded — archiving exists precisely so a
 * household can be retired without deleting its financial history.
 */
export const getHouseholdsForUser = cache(async (): Promise<HouseholdSummary[]> => {
  const user = await getUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("household_members")
    .select(
      `role,
       joined_at,
       households!inner (
         id,
         name,
         currency,
         archived_at,
         household_members(count)
       )`,
    )
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  if (error) {
    console.error("[data] getHouseholdsForUser failed", error.message);
    return [];
  }

  return (data ?? [])
    .filter((row) => row.households && !row.households.archived_at)
    .map((row) => ({
      id: row.households.id,
      name: row.households.name,
      currency: row.households.currency,
      role: row.role,
      memberCount: row.households.household_members[0]?.count ?? 1,
      joinedAt: row.joined_at,
    }));
});

/**
 * One household with its full member list.
 *
 * Returns null rather than throwing when the household is invisible, so callers
 * can render a 404 and cannot accidentally distinguish "does not exist" from
 * "not yours" — those must look identical from outside.
 */
export const getHouseholdWithMembers = cache(
  async (householdId: string): Promise<HouseholdDetail | null> => {
    const user = await getUser();
    if (!user) return null;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("households")
      .select(
        `id,
         name,
         currency,
         timezone,
         created_at,
         household_members (
           user_id,
           role,
           joined_at,
           profiles ( display_name, email, avatar_url )
         )`,
      )
      .eq("id", householdId)
      .maybeSingle();

    if (error) {
      console.error("[data] getHouseholdWithMembers failed", error.message);
      return null;
    }
    if (!data) return null;

    const members: MemberDetail[] = data.household_members
      .map((member) => ({
        userId: member.user_id,
        role: member.role,
        joinedAt: member.joined_at,
        displayName: member.profiles?.display_name ?? null,
        email: member.profiles?.email ?? null,
        avatarUrl: member.profiles?.avatar_url ?? null,
        isViewer: member.user_id === user.id,
      }))
      .sort(
        (a, b) =>
          ROLE_RANK[a.role] - ROLE_RANK[b.role] ||
          (a.displayName ?? a.email ?? "").localeCompare(
            b.displayName ?? b.email ?? "",
          ),
      );

    const viewerRole = members.find((member) => member.isViewer)?.role;
    if (!viewerRole) return null;

    return {
      id: data.id,
      name: data.name,
      currency: data.currency,
      timezone: data.timezone,
      createdAt: data.created_at,
      members,
      viewerRole,
    };
  },
);

/**
 * Invitations that are still outstanding: neither accepted nor revoked.
 *
 * Expired ones are kept in the result and flagged instead of being filtered out,
 * because an admin looking at the members page needs to see that the link they
 * sent last month is why nobody has joined.
 *
 * Only admins and owners can read this table at all, so a member calling it
 * simply gets an empty list from RLS rather than an error.
 */
export const getPendingInvitations = cache(
  async (householdId: string): Promise<PendingInvitation[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("invitations")
      .select("id, email, role, created_at, expires_at")
      .eq("household_id", householdId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[data] getPendingInvitations failed", error.message);
      return [];
    }

    const now = Date.now();
    return (data ?? []).map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      createdAt: invitation.created_at,
      expiresAt: invitation.expires_at,
      isExpired: new Date(invitation.expires_at).getTime() < now,
    }));
  },
);

export interface InvitationPreview {
  status:
    | "valid"
    | "invalid"
    | "revoked"
    | "used"
    | "expired"
    | "email_mismatch"
    | "already_member";
  householdId: string | null;
  householdName: string | null;
  invitedRole: HouseholdRole | null;
  inviterName: string | null;
  invitedEmail: string | null;
}

/**
 * Describes an invitation to the person holding its link.
 *
 * This has to be an RPC. The invitee is by definition not a member yet, so RLS
 * denies them both the `invitations` row and the `households` row it points at.
 * The `preview_invitation` function runs as definer and is keyed solely on the
 * raw token, so it discloses the household name to whoever already holds a valid
 * link and nothing at all to anyone else.
 */
export async function getInvitationPreview(token: string): Promise<InvitationPreview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_invitation", { p_token: token });

  if (error || !data?.[0]) {
    if (error) console.error("[data] getInvitationPreview failed", error.message);
    return {
      status: "invalid",
      householdId: null,
      householdName: null,
      invitedRole: null,
      inviterName: null,
      invitedEmail: null,
    };
  }

  const row = data[0];
  return {
    status: row.status as InvitationPreview["status"],
    householdId: row.household_id,
    householdName: row.household_name,
    invitedRole: row.invited_role,
    inviterName: row.inviter_name,
    invitedEmail: row.invited_email,
  };
}
