/**
 * Sign-in page.
 *
 * A Server Component: it reads the URL, renders static copy, and delegates the
 * only interactive part to <LoginForm>. Nothing here needs to ship to the
 * browser, so nothing does.
 *
 * Next.js 16 note: `searchParams` is a Promise and must be awaited. It is typed
 * with the framework's own value shape (a param can legitimately appear more
 * than once, making it an array) rather than being narrowed optimistically,
 * because a duplicated `?next=` would otherwise be a runtime surprise.
 */

import Link from "next/link";
import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to SplitMate to track shared expenses with your roommates.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Human explanations for the failures the callback route can redirect with. */
const ERROR_MESSAGES: Record<string, string> = {
  expired:
    "That sign-in link has expired or was already used. Enter your email to get a new one.",
  denied: "Sign-in was cancelled. You can try again whenever you're ready.",
  invalid: "That link didn't look right. Enter your email to get a new one.",
  oauth: "We couldn't reach Google just now. Try the email link instead.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const next = firstValue(params["next"]);
  const errorKey = firstValue(params["error"]);
  const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] : undefined;

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>
          Sign in to see what your household owes — no password needed.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <LoginForm {...(next ? { next } : {})} />

        <p className="text-muted-foreground text-center text-xs text-balance">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-4">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}

/** A query parameter can appear more than once; take the first occurrence. */
function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
