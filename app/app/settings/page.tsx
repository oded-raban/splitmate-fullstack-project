/**
 * Account settings — the profile every household you're in sees.
 * =============================================================================
 * Deliberately at `/app/settings`, one level up from
 * `/app/households/[id]/settings`: that page edits a household everyone in it
 * shares, this one edits the identity a single person carries across every
 * household they belong to. Nesting this under a household id would suggest
 * it only applied to that one.
 */

import { redirect } from "next/navigation";

import { getProfile, getUser } from "@/lib/auth";
import { initialsOf } from "@/lib/display";
import { ProfileForm } from "@/components/account/profile-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Settings" };

export default async function AccountSettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/app/settings");

  const profile = await getProfile();

  const displayName = profile?.display_name ?? "";
  const email = profile?.email ?? user.email ?? "";
  const avatarUrl = profile?.avatar_url ?? null;

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Your name and avatar — shared with every household you&rsquo;re in.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm
            displayName={displayName}
            email={email}
            avatarUrl={avatarUrl}
            initials={initialsOf({ displayName, email })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
