"use client";

/**
 * Confirmation for destructive actions.
 * =============================================================================
 * Two levels, chosen by whether `confirmPhrase` is supplied:
 *
 *   • Without it — an ordinary confirm step, for actions that are annoying to
 *     undo but not damaging.
 *   • With it — the user must type an exact phrase, usually the name of the
 *     thing being acted on. This is not friction for its own sake: it defeats
 *     the specific failure mode where someone clicks the wrong row's menu and
 *     confirms on autopilot, because the phrase they are asked to type belongs
 *     to a different row than the one they meant.
 *
 * The consequence is always stated in plain language. "This cannot be undone" is
 * not a consequence; "their expenses stay in the ledger and they lose access to
 * the household" is.
 */

import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ConfirmDialogProps {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** When set, the action stays disabled until this exact text is typed. */
  confirmPhrase?: string;
  onConfirm: () => Promise<void>;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmPhrase,
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [isPending, startTransition] = useTransition();

  const isUnlocked = !confirmPhrase || typed.trim() === confirmPhrase;

  function handleConfirm() {
    startTransition(async () => {
      await onConfirm();
      setOpen(false);
      setTyped("");
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped("");
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {confirmPhrase ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-phrase" className="text-sm font-normal">
              Type <span className="text-foreground font-medium">{confirmPhrase}</span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-phrase"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              data-testid="confirm-phrase"
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!isUnlocked || isPending}
            onClick={handleConfirm}
            data-testid="confirm-action"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Working…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
