/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by `npm run db:types` from the live database schema.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          household_id: string
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          household_id: string
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          household_id?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string
          created_at: string
          household_id: string | null
          icon: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          color?: string
          created_at?: string
          household_id?: string | null
          icon?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          color?: string
          created_at?: string
          household_id?: string | null
          icon?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_revisions: {
        Row: {
          after: Json
          before: Json
          changed_at: string
          changed_by: string
          expense_id: string
          id: string
        }
        Insert: {
          after: Json
          before: Json
          changed_at?: string
          changed_by: string
          expense_id: string
          id?: string
        }
        Update: {
          after?: Json
          before?: Json
          changed_at?: string
          changed_by?: string
          expense_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_revisions_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_revisions_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_splits: {
        Row: {
          expense_id: string
          share_input: number | null
          share_minor: number
          user_id: string
        }
        Insert: {
          expense_id: string
          share_input?: number | null
          share_minor: number
          user_id: string
        }
        Update: {
          expense_id?: string
          share_input?: number | null
          share_minor?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_splits_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_splits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_minor: number
          category_id: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string
          household_id: string
          id: string
          idempotency_key: string | null
          note: string | null
          payer_id: string
          receipt_path: string | null
          recurring_id: string | null
          spent_at: string
          split_method: Database["public"]["Enums"]["split_method"]
          updated_at: string
        }
        Insert: {
          amount_minor: number
          category_id?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description: string
          household_id: string
          id?: string
          idempotency_key?: string | null
          note?: string | null
          payer_id: string
          receipt_path?: string | null
          recurring_id?: string | null
          spent_at: string
          split_method: Database["public"]["Enums"]["split_method"]
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          category_id?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          household_id?: string
          id?: string
          idempotency_key?: string | null
          note?: string | null
          payer_id?: string
          receipt_path?: string | null
          recurring_id?: string | null
          spent_at?: string
          split_method?: Database["public"]["Enums"]["split_method"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          household_id: string
          joined_at: string
          role: Database["public"]["Enums"]["household_role"]
          user_id: string
        }
        Insert: {
          household_id: string
          joined_at?: string
          role?: Database["public"]["Enums"]["household_role"]
          user_id: string
        }
        Update: {
          household_id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["household_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          currency: string
          id: string
          name: string
          plan: string
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          name: string
          plan?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          name?: string
          plan?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "households_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string
          email: string | null
          expires_at: string
          household_id: string
          id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["household_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          expires_at: string
          household_id: string
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["household_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          expires_at?: string
          household_id?: string
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["household_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          household_id: string | null
          id: string
          payload: Json
          read_at: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id?: string | null
          id?: string
          payload?: Json
          read_at?: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string | null
          id?: string
          payload?: Json
          read_at?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      recurring_expenses: {
        Row: {
          amount_minor: number
          category_id: string | null
          created_at: string
          created_by: string
          day_of_period: number
          description: string
          frequency: Database["public"]["Enums"]["recurrence_freq"]
          household_id: string
          id: string
          is_active: boolean
          last_run_at: string | null
          next_run_at: string
          payer_id: string
          split_config: Json
          split_method: Database["public"]["Enums"]["split_method"]
          updated_at: string
        }
        Insert: {
          amount_minor: number
          category_id?: string | null
          created_at?: string
          created_by: string
          day_of_period: number
          description: string
          frequency: Database["public"]["Enums"]["recurrence_freq"]
          household_id: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at: string
          payer_id: string
          split_config: Json
          split_method: Database["public"]["Enums"]["split_method"]
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          category_id?: string | null
          created_at?: string
          created_by?: string
          day_of_period?: number
          description?: string
          frequency?: Database["public"]["Enums"]["recurrence_freq"]
          household_id?: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at?: string
          payer_id?: string
          split_config?: Json
          split_method?: Database["public"]["Enums"]["split_method"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount_minor: number
          created_at: string
          created_by: string
          from_user: string
          household_id: string
          id: string
          method: Database["public"]["Enums"]["settlement_method"]
          note: string | null
          settled_at: string
          to_user: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_minor: number
          created_at?: string
          created_by: string
          from_user: string
          household_id: string
          id?: string
          method?: Database["public"]["Enums"]["settlement_method"]
          note?: string | null
          settled_at?: string
          to_user: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_minor?: number
          created_at?: string
          created_by?: string
          from_user?: string
          household_id?: string
          id?: string
          method?: Database["public"]["Enums"]["settlement_method"]
          note?: string | null
          settled_at?: string
          to_user?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_from_user_fkey"
            columns: ["from_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_to_user_fkey"
            columns: ["to_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_items: {
        Row: {
          added_by: string
          archived_at: string | null
          checked_at: string | null
          checked_by: string | null
          converted_expense_id: string | null
          created_at: string
          estimated_minor: number | null
          household_id: string
          id: string
          list_id: string
          name: string
          position: number
          quantity: string | null
        }
        Insert: {
          added_by: string
          archived_at?: string | null
          checked_at?: string | null
          checked_by?: string | null
          converted_expense_id?: string | null
          created_at?: string
          estimated_minor?: number | null
          household_id: string
          id?: string
          list_id: string
          name: string
          position?: number
          quantity?: string | null
        }
        Update: {
          added_by?: string
          archived_at?: string | null
          checked_at?: string | null
          checked_by?: string | null
          converted_expense_id?: string | null
          created_at?: string
          estimated_minor?: number | null
          household_id?: string
          id?: string
          list_id?: string
          name?: string
          position?: number
          quantity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopping_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_converted_expense_id_fkey"
            columns: ["converted_expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_lists: {
        Row: {
          created_at: string
          created_by: string
          household_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          household_id: string
          id?: string
          name?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          household_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_lists_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      advance_recurrence: {
        Args: {
          p_day: number
          p_frequency: Database["public"]["Enums"]["recurrence_freq"]
          p_from: string
        }
        Returns: string
      }
      can_modify_expense: { Args: { p_expense_id: string }; Returns: boolean }
      checkout_shopping_items: {
        Args: { p_item_ids: string[]; p_payload: Json }
        Returns: string
      }
      create_expense_with_splits: { Args: { p_payload: Json }; Returns: string }
      create_household: {
        Args: { p_currency?: string; p_name: string; p_timezone?: string }
        Returns: string
      }
      generate_recurring_expense: {
        Args: { p_rule_id: string; p_splits: Json }
        Returns: string
      }
      get_household_balances: {
        Args: { p_household_id: string }
        Returns: {
          net: number
          owed: number
          paid: number
          settled_in: number
          settled_out: number
          user_id: string
        }[]
      }
      get_member_stats: {
        Args: { p_from: string; p_household_id: string; p_to: string }
        Returns: {
          consumed_minor: number
          expense_count: number
          paid_minor: number
          user_id: string
        }[]
      }
      get_monthly_breakdown: {
        Args: { p_from: string; p_household_id: string; p_to: string }
        Returns: {
          category_id: string
          category_name: string
          expense_count: number
          month: string
          total_minor: number
        }[]
      }
      has_household_role: {
        Args: {
          p_household_id: string
          p_roles: Database["public"]["Enums"]["household_role"][]
        }
        Returns: boolean
      }
      is_household_member: {
        Args: { p_household_id: string }
        Returns: boolean
      }
      is_member_of: {
        Args: { p_household_id: string; p_user_id: string }
        Returns: boolean
      }
      log_activity: {
        Args: {
          p_action: string
          p_entity_id: string
          p_entity_type: string
          p_household_id: string
          p_metadata?: Json
        }
        Returns: undefined
      }
      notify_users: {
        Args: {
          p_household_id: string
          p_payload?: Json
          p_type: Database["public"]["Enums"]["notification_type"]
          p_user_ids: string[]
        }
        Returns: undefined
      }
      preview_invitation: {
        Args: { p_token: string }
        Returns: {
          household_id: string
          household_name: string
          invited_email: string
          invited_role: Database["public"]["Enums"]["household_role"]
          inviter_name: string
          status: string
        }[]
      }
      settle_up: {
        Args: {
          p_amount_minor: number
          p_from_user: string
          p_household_id: string
          p_method?: Database["public"]["Enums"]["settlement_method"]
          p_note?: string
          p_to_user: string
        }
        Returns: string
      }
      shares_household_with: { Args: { p_user_id: string }; Returns: boolean }
      soft_delete_expense: {
        Args: { p_expense_id: string }
        Returns: undefined
      }
      storage_household_id: { Args: { p_object_name: string }; Returns: string }
      transfer_ownership: {
        Args: { p_household_id: string; p_new_owner_id: string }
        Returns: undefined
      }
      update_expense_with_splits: {
        Args: {
          p_expected_updated_at: string
          p_expense_id: string
          p_payload: Json
        }
        Returns: undefined
      }
      void_settlement: {
        Args: { p_reason?: string; p_settlement_id: string }
        Returns: undefined
      }
    }
    Enums: {
      household_role: "owner" | "admin" | "member"
      notification_type:
        | "invite_accepted"
        | "member_joined"
        | "member_removed"
        | "expense_created"
        | "expense_updated"
        | "expense_deleted"
        | "settlement_recorded"
        | "settlement_voided"
        | "recurring_generated"
      recurrence_freq: "weekly" | "monthly" | "yearly"
      settlement_method: "bit" | "bank_transfer" | "cash" | "paypal" | "other"
      split_method: "equal" | "exact" | "percentage" | "shares"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      household_role: ["owner", "admin", "member"],
      notification_type: [
        "invite_accepted",
        "member_joined",
        "member_removed",
        "expense_created",
        "expense_updated",
        "expense_deleted",
        "settlement_recorded",
        "settlement_voided",
        "recurring_generated",
      ],
      recurrence_freq: ["weekly", "monthly", "yearly"],
      settlement_method: ["bit", "bank_transfer", "cash", "paypal", "other"],
      split_method: ["equal", "exact", "percentage", "shares"],
    },
  },
} as const
