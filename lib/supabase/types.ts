/**
 * Domain-friendly names for the generated database types.
 * =============================================================================
 * `database.types.ts` is machine-written and reads like it: every row type is
 * spelled `Database["public"]["Tables"]["expense_splits"]["Row"]`. Feature code
 * importing that directly would be noisy, and would also bind every module to
 * the generated file's internal shape — so when the Supabase CLI changes how it
 * emits types (it has, more than once), the change would ripple everywhere
 * instead of stopping at this file.
 *
 * Naming convention: `Thing` is a row as it comes out of the database, `NewThing`
 * is the shape required to insert one, and `ThingUpdate` is the partial shape
 * accepted by an update.
 */

import {
  type Enums,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
} from "@/lib/supabase/database.types";
import { type SplitMethod as DomainSplitMethod } from "@/lib/domain/splits";

/* --- Enums -------------------------------------------------------------- */

export type HouseholdRole = Enums<"household_role">;
export type SplitMethod = Enums<"split_method">;
export type SettlementMethod = Enums<"settlement_method">;
export type RecurrenceFrequency = Enums<"recurrence_freq">;
export type NotificationType = Enums<"notification_type">;

/**
 * The domain layer deliberately declares its own `SplitMethod` so that the money
 * and allocation algorithms stay free of any database import. That independence
 * is only safe if the two definitions cannot drift apart, so the assignments
 * below fail to compile the moment a split method is added on one side and not
 * the other — which would otherwise surface as a runtime error deep inside an
 * expense write.
 */
const _splitMethodMatchesDatabase: DomainSplitMethod = null as unknown as SplitMethod;
const _splitMethodMatchesDomain: SplitMethod = null as unknown as DomainSplitMethod;
void _splitMethodMatchesDatabase;
void _splitMethodMatchesDomain;

/* --- Rows --------------------------------------------------------------- */

export type Profile = Tables<"profiles">;
export type Household = Tables<"households">;
export type HouseholdMember = Tables<"household_members">;
export type Invitation = Tables<"invitations">;
export type Category = Tables<"categories">;
export type Expense = Tables<"expenses">;
export type ExpenseSplit = Tables<"expense_splits">;
export type ExpenseRevision = Tables<"expense_revisions">;
export type RecurringExpense = Tables<"recurring_expenses">;
export type Settlement = Tables<"settlements">;
export type ShoppingList = Tables<"shopping_lists">;
export type ShoppingItem = Tables<"shopping_items">;
export type Notification = Tables<"notifications">;
export type ActivityEntry = Tables<"activity_log">;

/* --- Inserts and updates ------------------------------------------------ */

export type NewHousehold = TablesInsert<"households">;
export type NewCategory = TablesInsert<"categories">;
export type NewExpense = TablesInsert<"expenses">;
export type NewExpenseSplit = TablesInsert<"expense_splits">;
export type NewRecurringExpense = TablesInsert<"recurring_expenses">;
export type NewSettlement = TablesInsert<"settlements">;
export type NewShoppingList = TablesInsert<"shopping_lists">;
export type NewShoppingItem = TablesInsert<"shopping_items">;

export type ProfileUpdate = TablesUpdate<"profiles">;
export type HouseholdUpdate = TablesUpdate<"households">;
export type ExpenseUpdate = TablesUpdate<"expenses">;
export type ShoppingItemUpdate = TablesUpdate<"shopping_items">;
