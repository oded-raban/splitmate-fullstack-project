/**
 * Validation for a user's own profile.
 * =============================================================================
 * The length limit mirrors `profiles.display_name`'s check constraint (1–60
 * trimmed characters), for the same reason every other schema in this
 * directory mirrors its table: a value that passes here must never be
 * rejected later by the database for a limit the user was never shown.
 */

import { z } from "zod";

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name your roommates will recognise")
  .max(60, "That name is too long — 60 characters at most");

/**
 * An empty string from an untouched "Avatar URL" input means "no avatar", not
 * "an invalid one" — the same normalisation `createInvitationSchema` applies
 * to its optional email field, for the same reason: the column itself is
 * nullable, and the form's blank state should map to that, not to a rejection.
 */
export const avatarUrlSchema = z
  .union([z.literal(""), z.url({ error: "Enter a valid image URL" })])
  .optional()
  .transform((value) => (value ? value : null));

export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
  avatarUrl: avatarUrlSchema,
});
