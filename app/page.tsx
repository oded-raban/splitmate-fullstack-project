/**
 * Landing page.
 *
 * Public, but rendered per request rather than prerendered: `getUser()` reads
 * the session cookie so the header can send a signed-in visitor straight to
 * their household instead of asking them to sign in again. That is a deliberate
 * trade — losing static generation on one page in exchange for not showing
 * "Sign in" to somebody who already is.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ListChecks, Scale, Wallet } from "lucide-react";

import { getUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "SplitMate — shared expenses without the awkward conversation",
};

export default async function HomePage() {
  const user = await getUser();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between p-6">
        <span className="flex items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Wallet className="size-5" aria-hidden="true" />
          </span>
          SplitMate
        </span>

        <Button asChild variant={user ? "default" : "ghost"}>
          <Link href={user ? "/app" : "/login"}>
            {user ? "Open my household" : "Sign in"}
          </Link>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-12 px-6 py-16">
        <div className="space-y-6 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Nobody should have to ask their roommate for money twice.
          </h1>

          <p className="text-muted-foreground mx-auto max-w-xl text-lg text-balance">
            Log a shared expense in fifteen seconds, split it however you actually
            agreed, and let SplitMate work out the smallest set of payments that makes
            everyone even.
          </p>

          <div className="flex justify-center gap-3">
            <Button asChild size="lg">
              <Link href={user ? "/app" : "/login"}>
                Get started
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        <ul className="grid gap-6 sm:grid-cols-3">
          <Feature
            icon={<Scale className="size-5" aria-hidden="true" />}
            title="Split it properly"
            body="Evenly, by exact amounts, by percentage, or by weighted shares when someone has the bigger room."
          />
          <Feature
            icon={<Wallet className="size-5" aria-hidden="true" />}
            title="Settle in fewer payments"
            body="Circular debts cancel out, so three people owing each other becomes one transfer instead of three."
          />
          <Feature
            icon={<ListChecks className="size-5" aria-hidden="true" />}
            title="Shop together"
            body="A shared list that updates live on everyone's phone, and turns into a split expense at the till."
          />
        </ul>
      </main>

      <footer className="text-muted-foreground mx-auto w-full max-w-5xl p-6 text-sm">
        Built as a full-stack course project.
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="space-y-2">
      <span className="bg-muted text-foreground flex size-9 items-center justify-center rounded-lg">
        {icon}
      </span>
      <h2 className="font-medium">{title}</h2>
      <p className="text-muted-foreground text-sm">{body}</p>
    </li>
  );
}
