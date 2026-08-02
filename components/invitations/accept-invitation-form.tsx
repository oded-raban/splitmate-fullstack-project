"use client";

/**
 * The accept button on an invitation page.
 *
 * Acceptance is an explicit act, not a side effect of opening the link. Joining
 * someone's household on page load would mean a link forwarded "just so you can
 * see it" silently adds you, and a preview would be impossible — you would
 * already be a member by the time you read whose household it was.
 *
 * On success the action redirects on the server, so this component only ever
 * renders the pending state and the refusals. Navigating from the client
 * instead would re-render this page first, and by then the token it is holding
 * has been consumed — the invitee would watch their success turn into "this
 * invitation has already been used".
 */

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { acceptInvitation } from "@/lib/actions/invitations";
import { type ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";

const initialState: ActionResult<never> | undefined = undefined;

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(acceptInvitation, initialState);

  const error = state?.ok === false ? state.error.message : undefined;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />

      <Button
        type="submit"
        className="w-full"
        disabled={isPending}
        data-testid="accept-invitation"
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Joining…
          </>
        ) : (
          "Join household"
        )}
      </Button>

      {error ? (
        <p role="alert" className="text-destructive text-center text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
