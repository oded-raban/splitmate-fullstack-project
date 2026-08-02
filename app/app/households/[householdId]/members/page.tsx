/**
 * Members and invitations.
 * =============================================================================
 * Visible to every member, manageable only by owners and admins. The read is
 * open deliberately: knowing who is in the household and what they can do is
 * exactly the transparency that stops "who agreed to this?" arguments, and it is
 * information every member already has by living there.
 *
 * Pending invitations are the exception — RLS restricts that table to admins and
 * owners, so a member's query returns an empty list and the section is not
 * rendered for them at all.
 */

import { notFound } from "next/navigation";
import { Clock, Mail, Link2 } from "lucide-react";

import { getHouseholdWithMembers, getPendingInvitations } from "@/lib/data/households";
import { displayNameOf, initialsOf, ROLE_LABELS } from "@/lib/display";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TimeAgo } from "@/components/common/time-ago";
import { InviteDialog } from "@/components/members/invite-dialog";
import { MemberActions } from "@/components/members/member-actions";
import { RevokeInvitationButton } from "@/components/members/revoke-invitation-button";

export const metadata = { title: "Members" };

export default async function MembersPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;

  const household = await getHouseholdWithMembers(householdId);
  if (!household) notFound();

  const canManage =
    household.viewerRole === "owner" || household.viewerRole === "admin";
  const invitations = canManage ? await getPendingInvitations(householdId) : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {household.members.length} member{household.members.length === 1 ? "" : "s"}
          </CardTitle>
          {canManage ? (
            <CardAction>
              <InviteDialog householdId={householdId} />
            </CardAction>
          ) : null}
        </CardHeader>

        <CardContent>
          <ul className="divide-border divide-y">
            {household.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 py-3">
                <Avatar className="size-9">
                  {member.avatarUrl ? (
                    <AvatarImage src={member.avatarUrl} alt="" />
                  ) : null}
                  <AvatarFallback className="text-xs">
                    {initialsOf(member)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {displayNameOf(member)}
                    {member.isViewer ? (
                      <span className="text-muted-foreground font-normal"> (you)</span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {member.email} · joined <TimeAgo value={member.joinedAt} />
                  </p>
                </div>

                <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                  {ROLE_LABELS[member.role]}
                </Badge>

                <MemberActions
                  householdId={householdId}
                  member={member}
                  viewerRole={household.viewerRole}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending invitations</CardTitle>
          </CardHeader>

          <CardContent>
            {invitations.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No invitations waiting. Anyone you invite appears here until they join.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="flex items-center gap-3 py-3">
                    <span className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-full">
                      {invitation.email ? (
                        <Mail className="size-4" aria-hidden="true" />
                      ) : (
                        <Link2 className="size-4" aria-hidden="true" />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {invitation.email ?? "Shareable link"}
                      </p>
                      <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                        <Clock className="size-3" aria-hidden="true" />
                        {invitation.isExpired ? (
                          "Expired"
                        ) : (
                          <>
                            Expires <TimeAgo value={invitation.expiresAt} />
                          </>
                        )}
                        {" · joins as "}
                        {ROLE_LABELS[invitation.role].toLowerCase()}
                      </p>
                    </div>

                    {invitation.isExpired ? (
                      <Badge variant="outline">Expired</Badge>
                    ) : null}

                    <RevokeInvitationButton
                      householdId={householdId}
                      invitationId={invitation.id}
                      label={invitation.email ?? "shareable link"}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
