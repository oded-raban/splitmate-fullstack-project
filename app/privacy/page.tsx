/**
 * Privacy policy.
 * =============================================================================
 * Static and public, matching `docs/02-architecture.md` §5's page table. Not
 * boilerplate copied from a generator: every claim here is checked against
 * what the code actually does (`docs/06-security.md` for the mechanisms).
 *
 * Plain Tailwind utilities rather than the `@tailwindcss/typography` plugin —
 * two legal pages don't justify a new dependency the rest of the app has no
 * other use for.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { Wallet } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy — SplitMate",
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center p-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Wallet className="size-5" aria-hidden="true" />
          </span>
          SplitMate
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-6 py-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Last updated: August 2026
          </p>
        </div>

        <Section title="What we collect">
          <p>
            When you create an account, we store your email address, a display name, and
            optionally an avatar URL, so your roommates can tell who added an expense.
            If you sign in with Google, your name and avatar are read from your Google
            profile the first time you sign in; if you use a magic link, you choose your
            own display name.
          </p>
          <p>
            Everything else you enter into a household — expense descriptions, amounts,
            receipt photos, shopping-list items, and settlement records — is stored so
            the ledger works. None of it is used for anything other than showing it back
            to the members of that household.
          </p>
        </Section>

        <Section title="Who can see your data">
          <p>
            Only the members of a household you belong to can see that household&rsquo;s
            expenses, balances, and activity — enforced at the database level with
            Row-Level Security, not just by the pages you&rsquo;re shown. Your profile
            (name, email, avatar) is visible to people you share a household with, and
            to no one else.
          </p>
        </Section>

        <Section title="Receipts">
          <p>
            Receipt photos are stored in a private file bucket. They are never publicly
            addressable; viewing one generates a short-lived, signed link that expires
            shortly after it&rsquo;s issued.
          </p>
        </Section>

        <Section title="What we don't do">
          <ul className="list-disc space-y-1 pl-5">
            <li>We don&rsquo;t sell your data, to anyone, ever.</li>
            <li>We don&rsquo;t show ads or use your data for advertising.</li>
            <li>
              We don&rsquo;t share your data with third parties, other than the
              infrastructure providers that run the service (Supabase for the database
              and authentication, Vercel for hosting, Resend for sending invitation
              emails) — each processes data only as needed to provide that
              infrastructure.
            </li>
          </ul>
        </Section>

        <Section title="Data retention and deletion">
          <p>
            Deleting an expense removes it from your balances but keeps a record in the
            household&rsquo;s audit trail, the same way a bank statement doesn&rsquo;t
            un-happen a reversed transaction. Account deletion is not yet self-service;
            contact us and we will remove your profile and anonymise records that other
            members&rsquo; balances still depend on.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy or your data can be sent via the{" "}
            <a
              href="https://github.com/oded-raban/splitmate-fullstack-project"
              className="underline underline-offset-4"
            >
              GitHub project
            </a>
            .
          </p>
        </Section>
      </main>

      <footer className="text-muted-foreground mx-auto w-full max-w-3xl p-6 text-sm">
        <Link
          href="/"
          className="hover:text-foreground underline-offset-4 hover:underline"
        >
          ← Back to SplitMate
        </Link>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="text-muted-foreground space-y-2 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  );
}
