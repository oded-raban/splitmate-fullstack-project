/**
 * Not-found boundary for pages inside a household.
 *
 * Catches `notFound()` thrown from a page in this subtree — most often
 * `requireRole` refusing a member who typed an admin-only URL. Because the
 * household layout above it rendered successfully, this appears with the
 * household's nav still in place, which is right: the household is real and the
 * viewer belongs to it, only this page is out of reach.
 *
 * A layout-level refusal (not a member at all) never reaches here, since the
 * layout that threw cannot also render its own boundary. That case is handled
 * one level up, in `app/app/not-found.tsx`.
 */

import { NotFoundCard } from "@/components/common/not-found-card";

export default function HouseholdNotFound() {
  return <NotFoundCard />;
}
