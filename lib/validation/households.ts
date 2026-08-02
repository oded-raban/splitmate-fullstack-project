/**
 * Validation schemas for households, members and invitations.
 * =============================================================================
 * Shared by the client form and the Server Action, so the rule a user sees while
 * typing is literally the same object the server enforces. The limits mirror the
 * database check constraints — `households.name` is `between 1 and 80` there —
 * so a value that passes here cannot be rejected later for a reason the user was
 * never shown.
 */

import { z } from "zod";

import { emailSchema } from "@/lib/validation/auth";

/** Every identifier crossing an action boundary is a UUID from our own schema. */
export const uuidSchema = z.uuid({ error: "That link doesn't look right" });

/**
 * Roles that may be *assigned*. Owner is absent by design: there is exactly one
 * owner per household (enforced by a partial unique index), and ownership moves
 * through `transferOwnership`, never through an invitation or a role dropdown.
 */
export const assignableRoleSchema = z.enum(["admin", "member"], {
  error: "Choose either Admin or Member",
});

export const householdNameSchema = z
  .string()
  .trim()
  .min(1, "Give your household a name")
  .max(80, "That name is too long — 80 characters at most");

export const createHouseholdSchema = z.object({
  name: householdNameSchema,
  /**
   * Fixed at creation and never editable afterwards. Changing it would silently
   * reinterpret every amount already recorded: ₪1,200 of rent does not become
   * $1,200 because someone edited a dropdown.
   */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code")
    .default("ILS"),
});

export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;

export const updateHouseholdSchema = z.object({
  householdId: uuidSchema,
  name: householdNameSchema,
});

export const householdIdSchema = z.object({ householdId: uuidSchema });

export const memberSchema = z.object({
  householdId: uuidSchema,
  userId: uuidSchema,
});

export const changeRoleSchema = memberSchema.extend({
  role: assignableRoleSchema,
});

export const createInvitationSchema = z.object({
  householdId: uuidSchema,
  /**
   * Optional, and the choice is meaningful rather than a convenience:
   *
   *   • with an address — only that address may accept, so the link is useless
   *     if it is forwarded or leaks out of an inbox;
   *   • without one — anyone holding the link may accept, which is what makes
   *     "paste it in the group chat" work.
   *
   * An empty string from an untouched form input means "no address", not "an
   * invalid address", so it is normalised away before the email rules apply.
   */
  email: z
    .union([z.literal(""), emailSchema])
    .optional()
    .transform((value) => (value ? value : undefined)),
  role: assignableRoleSchema.default("member"),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const invitationIdSchema = z.object({
  householdId: uuidSchema,
  invitationId: uuidSchema,
});

/**
 * The raw token from an invitation URL. Not a UUID: it is 32 random bytes in
 * base64url, so it is validated by shape and length rather than by format, and
 * bounded so an oversized value never reaches the hash function.
 */
export const invitationTokenSchema = z
  .string()
  .trim()
  .min(16, "That invitation link is incomplete")
  .max(128, "That invitation link doesn't look right")
  .regex(/^[A-Za-z0-9_-]+$/, "That invitation link doesn't look right");

export const acceptInvitationSchema = z.object({ token: invitationTokenSchema });
