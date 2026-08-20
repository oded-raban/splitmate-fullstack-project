"use client";

/**
 * Edit your own display name and avatar.
 * =============================================================================
 * Mirrors `components/households/rename-household-form.tsx`'s shape exactly —
 * same `useActionState` wiring, same inline field-error pattern — because it
 * is the same kind of form (one aggregate, one Server Action, optimistic
 * disabled state while pending) and a second pattern for the same problem
 * would just be something else to keep in sync.
 */

import { useActionState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateProfile } from "@/lib/actions/profile";
import { type ActionResult } from "@/lib/result";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionResult<{ displayName: string }> | undefined = undefined;

interface ProfileFormProps {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  initials: string;
}

export function ProfileForm({
  displayName,
  email,
  avatarUrl,
  initials,
}: ProfileFormProps) {
  const [state, formAction, isPending] = useActionState(updateProfile, initialState);

  const nameErrors =
    state?.ok === false ? state.error.fieldErrors?.["displayName"] : undefined;
  const avatarErrors =
    state?.ok === false ? state.error.fieldErrors?.["avatarUrl"] : undefined;

  useEffect(() => {
    if (state?.ok && state.data) toast.success("Profile updated");
    else if (state?.ok === false && state.error.code !== "VALIDATION") {
      toast.error(state.error.message);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="flex items-center gap-4">
        <Avatar className="size-14">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-medium">
            {state?.ok && state.data ? state.data.displayName : displayName}
          </p>
          <p className="text-muted-foreground text-sm">{email}</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-display-name">Display name</Label>
        <Input
          id="profile-display-name"
          name="displayName"
          defaultValue={displayName}
          maxLength={60}
          required
          aria-invalid={nameErrors ? true : undefined}
          aria-describedby={nameErrors ? "profile-display-name-error" : undefined}
          disabled={isPending}
          data-testid="profile-display-name"
        />
        {nameErrors ? (
          <p
            id="profile-display-name-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {nameErrors[0]}
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">
          Shown to every roommate you share a household with.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-avatar-url">Avatar URL</Label>
        <Input
          id="profile-avatar-url"
          name="avatarUrl"
          type="url"
          placeholder="https://…"
          defaultValue={avatarUrl ?? ""}
          aria-invalid={avatarErrors ? true : undefined}
          aria-describedby={avatarErrors ? "profile-avatar-url-error" : undefined}
          disabled={isPending}
          data-testid="profile-avatar-url"
        />
        {avatarErrors ? (
          <p
            id="profile-avatar-url-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {avatarErrors[0]}
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">
          Leave blank to show your initials instead. Signing in with Google sets this
          automatically the first time.
        </p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
      </Button>
    </form>
  );
}
