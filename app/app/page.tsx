/**
 * Signed-in landing.
 *
 * Currently a holding page that proves the authentication loop works end to
 * end: sign in, land here as a verified user, sign out. It becomes the
 * household dashboard (balance summary, recent expenses, quick add) once the
 * schema has been applied and the household queries exist.
 */

import type { Metadata } from "next";

import { signOut } from "@/lib/actions/auth";
import { requireUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Home",
};

export default async function AppHomePage() {
  const user = await requireUser("/app");

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>You&apos;re signed in</CardTitle>
          <CardDescription>
            Signed in as {user.email}. Your household dashboard will live here.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form action={signOut}>
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
