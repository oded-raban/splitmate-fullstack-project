"use client";

/**
 * Per-member management menu.
 * =============================================================================
 * Shown only to owners and admins, and only against members they may act on.
 * Two rules are encoded in what renders rather than in what errors:
 *
 *   • Nothing is offered against the owner. Their role cannot be changed here
 *     and they cannot be removed from their own household.
 *   • Ownership transfer is offered only to the owner, because it is the one
 *     action that takes something away from the person performing it.
 *
 * The actions return `ActionResult` rather than throwing, so a refusal from the
 * database — "they still owe money" — arrives as a sentence to show rather than
 * an exception to swallow.
 */

import { useTransition } from "react";
import { Crown, MoreHorizontal, ShieldCheck, UserMinus, UserRound } from "lucide-react";
import { toast } from "sonner";

import {
  changeMemberRole,
  removeMember,
  transferOwnership,
} from "@/lib/actions/members";
import { type MemberDetail } from "@/lib/data/households";
import { displayNameOf } from "@/lib/display";
import { type ActionResult } from "@/lib/result";
import { type HouseholdRole } from "@/lib/supabase/types";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MemberActionsProps {
  householdId: string;
  member: MemberDetail;
  viewerRole: HouseholdRole;
}

/** Reports an action's outcome once, in one place, so no call site forgets to. */
function report(result: ActionResult<unknown>, successMessage: string) {
  if (result.ok) toast.success(successMessage);
  else toast.error(result.error.message);
}

export function MemberActions({ householdId, member, viewerRole }: MemberActionsProps) {
  const [isPending, startTransition] = useTransition();

  const canManage = viewerRole === "owner" || viewerRole === "admin";
  const name = displayNameOf(member);

  // The owner's row offers nothing: an owner cannot be demoted or removed, and
  // rendering a menu whose every item is refused would be worse than no menu.
  if (!canManage || member.role === "owner" || member.isViewer) return null;

  function fields() {
    const formData = new FormData();
    formData.set("householdId", householdId);
    formData.set("userId", member.userId);
    return formData;
  }

  function setRole(role: "admin" | "member") {
    startTransition(async () => {
      const formData = fields();
      formData.set("role", role);
      report(
        await changeMemberRole(formData),
        role === "admin" ? `${name} is now an admin` : `${name} is now a member`,
      );
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={isPending}
          aria-label={`Manage ${name}`}
          data-testid={`member-actions-${member.userId}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {member.role === "member" ? (
          <DropdownMenuItem onSelect={() => setRole("admin")} className="gap-2">
            <ShieldCheck className="size-4" />
            Make admin
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setRole("member")} className="gap-2">
            <UserRound className="size-4" />
            Revoke admin
          </DropdownMenuItem>
        )}

        {viewerRole === "owner" ? (
          <ConfirmDialog
            trigger={
              <DropdownMenuItem
                className="gap-2"
                onSelect={(event) => event.preventDefault()}
              >
                <Crown className="size-4" />
                Make owner
              </DropdownMenuItem>
            }
            title={`Make ${name} the owner?`}
            description={
              <>
                <p>
                  {name} gets full control of this household, including the ability to
                  delete it.
                </p>
                <p>
                  You become an admin. You can still invite, remove members and edit
                  expenses, but you cannot take ownership back — only {name} can hand it
                  over.
                </p>
              </>
            }
            confirmLabel="Transfer ownership"
            confirmPhrase={name}
            onConfirm={async () => {
              report(
                await transferOwnership(fields()),
                `${name} now owns this household`,
              );
            }}
          />
        ) : null}

        <DropdownMenuSeparator />

        <ConfirmDialog
          trigger={
            <DropdownMenuItem
              variant="destructive"
              className="gap-2"
              onSelect={(event) => event.preventDefault()}
            >
              <UserMinus className="size-4" />
              Remove from household
            </DropdownMenuItem>
          }
          title={`Remove ${name}?`}
          description={
            <>
              <p>They lose access to this household immediately.</p>
              <p>
                Expenses they recorded stay in the ledger, and so does their share of
                every split — removing someone does not rewrite history. If they still
                owe or are owed anything, settle up first.
              </p>
            </>
          }
          confirmLabel="Remove member"
          confirmPhrase={name}
          onConfirm={async () => {
            report(await removeMember(fields()), `${name} was removed`);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
