/**
 * Input schemas for recurring expense rules.
 * =============================================================================
 * A rule is a promise about the future, so its inputs get checked harder than a
 * one-off expense's. A typo in an expense is one wrong row that somebody
 * notices; a typo in a rule is a wrong row every month until someone works out
 * where it is coming from.
 */

import { z } from "zod";

import { uuidSchema } from "@/lib/validation/households";

export const RECURRENCE_LABELS = {
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
} as const;

/**
 * What `day_of_period` means depends on the frequency, which is why the range is
 * only fully checkable once both are known — see the refinement below.
 */
const dayOfPeriodSchema = z.coerce
  .number()
  .int("Pick a day")
  .min(1, "Pick a day")
  .max(31, "Pick a day");

export const recurringRuleSchema = z
  .object({
    householdId: uuidSchema,
    description: z
      .string()
      .trim()
      .min(1, "Give it a name, like Rent or Netflix")
      .max(120, "Keep it under 120 characters"),
    amount: z.string().trim().min(1, "Enter an amount").max(20),
    payerId: uuidSchema,
    categoryId: z
      .union([uuidSchema, z.literal("")])
      .optional()
      .transform((value) => value || null),
    frequency: z.enum(["weekly", "monthly", "yearly"]),
    dayOfPeriod: dayOfPeriodSchema,
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date")
      .refine((value) => !Number.isNaN(Date.parse(value)), "Choose a valid date"),
  })
  .refine(
    (value) => value.frequency !== "weekly" || value.dayOfPeriod <= 7,
    // For a weekly rule the day is a weekday, so 1–7. Caught here rather than by
    // the database's 1–31 CHECK, which would accept "every week on the 19th" —
    // a rule that is meaningless but perfectly storable.
    { path: ["dayOfPeriod"], message: "Pick a day of the week" },
  );

export const toggleRuleSchema = z.object({
  householdId: uuidSchema,
  ruleId: uuidSchema,
  isActive: z.boolean(),
});

export const deleteRuleSchema = z.object({
  householdId: uuidSchema,
  ruleId: uuidSchema,
});

export type RecurringRuleInput = z.infer<typeof recurringRuleSchema>;
