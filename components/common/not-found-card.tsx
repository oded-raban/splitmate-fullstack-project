/**
 * The "nothing here" panel, shared by every not-found boundary in the app.
 * =============================================================================
 * Two situations reach it and are deliberately indistinguishable: the thing does
 * not exist, and the thing exists but the viewer may not see it. Saying "you
 * don't have access to this one" would confirm that a household with that id
 * exists — precisely the fact a non-member is not entitled to learn, and with
 * ids in URLs that people paste around, precisely the fact that would make
 * guessing worthwhile.
 *
 * The same panel also serves a member who reached an admin-only route, because
 * `requireRole` calls `notFound()` rather than rendering a refusal.
 */

import Link from "next/link";
import { ArrowRight, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function NotFoundCard() {
  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardHeader className="items-center space-y-3 text-center">
        <span className="bg-muted flex size-11 items-center justify-center rounded-full">
          <SearchX className="text-muted-foreground size-5" aria-hidden="true" />
        </span>
        <CardTitle className="text-lg">Nothing here</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-center">
        <p className="text-muted-foreground text-sm">
          This page doesn’t exist, or it belongs to a household you’re not part of. If a
          roommate sent you here, ask them for an invitation link.
        </p>

        <Button asChild variant="outline" className="w-full">
          <Link href="/app">
            Go to your households
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
