/**
 * Terms of service.
 * =============================================================================
 * See `app/privacy/page.tsx` for the sibling page and the reasoning behind
 * hand-written content and plain Tailwind utilities instead of a plugin.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { Wallet } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service — SplitMate",
};

export default function TermsPage() {
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
          <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Last updated: August 2026
          </p>
        </div>

        <Section title="What SplitMate is">
          <p>
            SplitMate is a record-keeping tool for splitting shared household expenses.
            It tracks who paid what, computes each member&rsquo;s share, and suggests
            the smallest set of transfers to settle up.
          </p>
        </Section>

        <Section title="SplitMate does not move money">
          <p>
            Recording a settlement in SplitMate — marking a payment as
            &ldquo;Bit&rdquo;, &ldquo;bank transfer&rdquo;, &ldquo;cash&rdquo;, or
            &ldquo;other&rdquo; — is a record that a payment happened outside the app.
            SplitMate does not process, hold, or transmit money on your behalf. You are
            responsible for actually completing payments with your roommates through
            whatever method you record.
          </p>
        </Section>

        <Section title="Your responsibilities">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              You are responsible for the accuracy of what you enter — amounts, who
              paid, and how a cost is split.
            </li>
            <li>
              You are responsible for keeping your account secure. Sign-in is
              passwordless (a one-time link to your email, or Google), so protecting
              your email account protects your SplitMate account.
            </li>
            <li>
              Households are shared spaces. Anything you record is visible to every
              member of that household.
            </li>
          </ul>
        </Section>

        <Section title="Availability">
          <p>
            SplitMate is provided as-is, without a guaranteed uptime commitment. We aim
            to keep it available and your data intact, but disputes over money between
            roommates are between roommates — SplitMate is a record of what was agreed,
            not a party to the agreement.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            These terms may be updated as the product changes. Continuing to use
            SplitMate after a change means you accept the updated terms.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms can be sent via the{" "}
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
