/**
 * Downloads the ledger as CSV.
 * =============================================================================
 * A plain link, not a button with a fetch behind it. The browser already knows
 * how to download a response carrying Content-Disposition — it shows progress,
 * handles the save dialog, resumes, and works with the keyboard and with a
 * middle click. Reimplementing that with fetch and a synthetic anchor would mean
 * buffering the whole file in memory to reproduce behaviour that is free here.
 *
 * A Server Component: there is no state and no event handler, so shipping a
 * kilobyte of JavaScript to render an anchor would be pure cost.
 */

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ExportButtonProps {
  householdId: string;
  from: string;
  to: string;
}

export function ExportButton({ householdId, from, to }: ExportButtonProps) {
  const href = `/api/households/${householdId}/export?from=${from}&to=${to}`;

  return (
    <Button asChild variant="outline" size="sm">
      {/*
        `download` asks for a save rather than a navigation, and a plain <a>
        rather than next/link because this is not an application route — Link
        would prefetch it, downloading the file on hover.
      */}
      <a href={href} download data-testid="export-csv">
        <Download className="size-4" />
        Export CSV
      </a>
    </Button>
  );
}
