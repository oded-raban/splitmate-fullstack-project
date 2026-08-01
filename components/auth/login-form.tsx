"use client";

/**
 * Sign-in form.
 * =============================================================================
 * A Client Component because it owns interactive state: the pending indicator
 * while the link is sent, and the confirmation panel that replaces the form
 * afterwards.
 *
 * Built on `useActionState`, which calls the Server Action directly and gives
 * back its `ActionResult` plus a pending flag. Two consequences worth noting:
 *
 *   • There is no fetch call, no API route and no client-side error handling to
 *     write — the action's return value *is* the state.
 *   • Because it is a real <form> with a server action, it works before
 *     JavaScript has hydrated. On a slow phone in a shop, the sign-in form is
 *     functional the moment the HTML arrives.
 */

import { useActionState } from "react";
import { Loader2, Mail } from "lucide-react";

import { requestMagicLink, signInWithGoogle } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginFormProps {
  /** Path to return to after signing in, propagated through the whole flow. */
  next?: string;
}

const initialState: ActionResult<{ email: string }> | undefined = undefined;

export function LoginForm({ next }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(requestMagicLink, initialState);

  // The link was sent. Replacing the form entirely — rather than showing a
  // toast above it — is deliberate: the next action is in the user's inbox, not
  // on this page, and leaving a live "send" button invites a second click that
  // invalidates the link they are about to receive.
  if (state?.ok && state.data) {
    return (
      <div className="space-y-4 text-center">
        <div className="bg-primary/10 mx-auto flex size-12 items-center justify-center rounded-full">
          <Mail className="text-primary size-6" aria-hidden="true" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="text-muted-foreground text-sm">
            We sent a sign-in link to{" "}
            <span className="text-foreground font-medium">{state.data.email}</span>. The
            link expires in an hour.
          </p>
        </div>

        <p className="text-muted-foreground text-xs">
          Nothing arrived? Check your spam folder, or{" "}
          <button
            type="button"
            className="text-foreground underline underline-offset-4"
            onClick={() => window.location.reload()}
          >
            try a different address
          </button>
          .
        </p>
      </div>
    );
  }

  const emailErrors =
    state?.ok === false ? state.error.fieldErrors?.["email"] : undefined;
  const formError =
    state?.ok === false && state.error.code !== "VALIDATION"
      ? state.error.message
      : undefined;

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            // Ties the input to its error message for screen readers, so the
            // failure is announced rather than only shown.
            aria-invalid={emailErrors ? true : undefined}
            aria-describedby={emailErrors ? "email-error" : undefined}
            disabled={isPending}
          />
          {emailErrors ? (
            <p id="email-error" role="alert" className="text-destructive text-sm">
              {emailErrors[0]}
            </p>
          ) : null}
        </div>

        {formError ? (
          <p role="alert" className="text-destructive text-sm">
            {formError}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Sending link…
            </>
          ) : (
            "Email me a sign-in link"
          )}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="border-border w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card text-muted-foreground px-2">or</span>
        </div>
      </div>

      {/* A separate form, because this action navigates to Google rather than
          returning a result to render. */}
      <form action={signInWithGoogle}>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Button type="submit" variant="outline" className="w-full">
          <GoogleIcon />
          Continue with Google
        </Button>
      </form>
    </div>
  );
}

/** Google's mark, inlined because lucide-react ships no brand logos. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
      />
    </svg>
  );
}
