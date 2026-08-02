/**
 * Household workspace shell.
 * =============================================================================
 * The membership guard for everything under `/app/households/[householdId]`.
 *
 * A non-member gets a 404, not a 403. Refusing with "you don't have permission
 * to view this household" confirms that the household exists — and since the id
 * is a UUID in a URL that people paste to each other, a distinguishable response
 * would turn this route into an oracle for testing guesses. A household you
 * cannot see should be indistinguishable from one that was never created.
 *
 * The guard runs once here rather than in each of the six pages beneath it, so a
 * page added later is protected by default instead of by remembering to be.
 */

import { notFound } from "next/navigation";

import { requireMembership } from "@/lib/auth";
import { getHouseholdWithMembers } from "@/lib/data/households";
import { HouseholdNav } from "@/components/layout/household-nav";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const household = await getHouseholdWithMembers(householdId);
  return { title: household?.name ?? "Household" };
}

export default async function HouseholdLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const { role } = await requireMembership(householdId);

  const household = await getHouseholdWithMembers(householdId);
  if (!household) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4">
      <div className="pt-6 pb-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight">
          {household.name}
        </h1>
      </div>

      <HouseholdNav householdId={householdId} role={role} />

      <div className="py-6">{children}</div>
    </div>
  );
}
