/**
 * Household settings.
 * =============================================================================
 * Restricted to owners and admins by `requireRole`, which 404s anyone else — the
 * same treatment a non-member gets, for the same reason: a distinguishable
 * refusal tells the asker something they were not entitled to learn.
 *
 * The nav does not render this tab for members, so reaching it at all means
 * typing the URL. The guard exists for exactly that case.
 */

import { notFound } from "next/navigation";

import { MANAGER_ROLES, requireRole } from "@/lib/auth";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { LeaveHouseholdButton } from "@/components/households/leave-household-button";
import { RenameHouseholdForm } from "@/components/households/rename-household-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Settings" };

export default async function HouseholdSettingsPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const { role } = await requireRole(householdId, MANAGER_ROLES);

  const household = await getHouseholdWithMembers(householdId);
  if (!household) notFound();

  return (
    <div className="max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Household</CardTitle>
        </CardHeader>
        <CardContent>
          <RenameHouseholdForm
            householdId={householdId}
            name={household.name}
            currency={household.currency}
          />
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive text-base">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {role === "owner" ? (
            <p className="text-muted-foreground text-sm">
              You own this household, so you can’t leave it. Make another member the
              owner from the Members tab first — that hands over control and lets you
              leave.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                Leaving removes your access. Settle any outstanding balance first, or
                the household will be left with splits against someone who is gone.
              </p>
              <LeaveHouseholdButton
                householdId={householdId}
                householdName={household.name}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
