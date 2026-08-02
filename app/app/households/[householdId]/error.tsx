"use client";

/**
 * Error boundary for the household workspace.
 * =============================================================================
 * Reached when something genuinely unexpected throws — a query that fails, a
 * network partition, a bug. Expected refusals never arrive here: those are
 * returned as `ActionResult` and rendered next to the control that caused them.
 *
 * The message is deliberately generic. In production React replaces a thrown
 * error's text with a digest precisely so internal detail cannot leak, and
 * repeating a raw message here would undo that. The digest is shown because it
 * is the one thing that lets a report be matched to a specific server log entry.
 *
 * `reset()` re-renders the segment rather than reloading the page, so a
 * transient failure costs a click instead of a full round trip.
 */

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function HouseholdError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry replaces this in Phase 10; until then the browser console is the
    // only place a failure in production would otherwise be visible at all.
    console.error("[household] render failed", error);
  }, [error]);

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="items-center space-y-3 text-center">
        <span className="bg-destructive/10 flex size-11 items-center justify-center rounded-full">
          <TriangleAlert className="text-destructive size-5" aria-hidden="true" />
        </span>
        <CardTitle className="text-lg">This household didn’t load</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-center">
        <p className="text-muted-foreground text-sm">
          Something went wrong on our side. Nothing you did caused it, and nothing has
          been changed.
        </p>

        <div className="flex justify-center gap-2">
          <Button onClick={reset}>
            <RotateCw className="size-4" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/app">Your households</Link>
          </Button>
        </div>

        {error.digest ? (
          <p className="text-muted-foreground font-mono text-xs">
            Reference: {error.digest}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
