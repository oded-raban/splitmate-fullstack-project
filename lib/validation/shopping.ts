/**
 * Input schemas for the shopping list.
 * =============================================================================
 * Looser than the expense schemas, on purpose. A shopping list is written while
 * standing in a kitchen deciding what has run out, and every required field is
 * a reason to close the app and not come back. Only the name is mandatory;
 * quantity is free text because "2", "a big one" and "500g" are all things
 * people actually write, and none of them is a number.
 */

import { z } from "zod";

import { uuidSchema } from "@/lib/validation/households";

const nameSchema = z
  .string()
  .trim()
  .min(1, "What do you need?")
  .max(80, "Keep it under 80 characters");

/**
 * Free text, not a number. Parsing "a big one" into a quantity is impossible,
 * and rejecting it would mean the list cannot say what the person meant.
 */
const quantitySchema = z
  .string()
  .trim()
  .max(20, "Keep the quantity under 20 characters")
  .optional()
  .transform((value) => value || undefined);

export const addShoppingItemSchema = z.object({
  householdId: uuidSchema,
  listId: uuidSchema,
  name: nameSchema,
  quantity: quantitySchema,
});

export const toggleShoppingItemSchema = z.object({
  householdId: uuidSchema,
  itemId: uuidSchema,
  /** The state being moved TO, sent by the client so a double-tap is idempotent. */
  checked: z.boolean(),
});

export const removeShoppingItemSchema = z.object({
  householdId: uuidSchema,
  itemId: uuidSchema,
});

/**
 * Turning ticked items into a shared expense.
 *
 * The amount is what the till actually charged, which is never the sum of the
 * guesses on the list — so it is asked for rather than computed. Participants
 * are omitted deliberately: a supermarket run is split equally between everyone
 * in the household, and offering four split methods at the checkout would put a
 * decision in the way of the one action that closes the loop.
 */
export const checkoutSchema = z.object({
  householdId: uuidSchema,
  itemIds: z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Could not read the selection" });
        return z.NEVER;
      }
    })
    .pipe(z.array(uuidSchema).min(1, "Tick something first").max(200)),
  amount: z.string().trim().min(1, "Enter what it cost").max(20),
  payerId: uuidSchema,
  categoryId: z
    .union([uuidSchema, z.literal("")])
    .optional()
    .transform((value) => value || null),
  spentAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Choose a valid date"),
});

export type AddShoppingItemInput = z.infer<typeof addShoppingItemSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
