/**
 * Not-found boundary for the signed-in area.
 *
 * This is the one that catches a non-member opening a household URL: the guard
 * lives in the household layout, and a layout that throws cannot render a
 * boundary nested inside itself, so the refusal surfaces here — inside the app
 * shell, with the header and household switcher intact, rather than on the bare
 * framework 404 page that would strip the user of any way onward.
 */

import { NotFoundCard } from "@/components/common/not-found-card";

export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <NotFoundCard />
    </div>
  );
}
