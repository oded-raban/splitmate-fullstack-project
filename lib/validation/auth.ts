/**
 * Validation schemas for authentication input.
 * =============================================================================
 * These schemas are shared between the client form and the Server Action, which
 * is the point: one definition, so the rule the user sees while typing and the
 * rule enforced on the server cannot drift apart.
 *
 * That sharing is a convenience, not a security measure. Client-side validation
 * exists purely so the user gets an answer without a round trip; it can be
 * bypassed by anyone with a terminal. The server parse is the one that counts,
 * and every action performs it regardless of what the client claims to have
 * checked.
 */

import { z } from "zod";

export const emailSchema = z
  .email({ error: "Enter a valid email address" })
  // Normalising here rather than at every call site means "Maya@Example.com "
  // and "maya@example.com" are treated as the same person when an invitation is
  // matched against an account.
  .transform((value) => value.trim().toLowerCase());

export const magicLinkSchema = z.object({
  email: emailSchema,
  /**
   * Where to send the user after they click the link in their inbox.
   *
   * SECURITY: only same-origin paths are accepted. Without this check the field
   * is an open redirect — an attacker could send `?next=https://evil.example`
   * and have our own login flow deliver an authenticated user to their site.
   * Requiring a leading "/" and rejecting "//" (which browsers read as a
   * protocol-relative absolute URL) closes both variants.
   */
  next: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      if (!value.startsWith("/") || value.startsWith("//")) return undefined;
      return value;
    }),
});

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;

export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter a name your roommates will recognise")
    .max(60, "That name is too long"),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/**
 * Turns a Zod error into the field-error shape that `ActionResult` carries and
 * react-hook-form consumes, so each message lands on the input that caused it
 * instead of as one lump at the top of the form.
 */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    const existing = fieldErrors[key];
    if (existing) {
      existing.push(issue.message);
    } else {
      fieldErrors[key] = [issue.message];
    }
  }

  return fieldErrors;
}
