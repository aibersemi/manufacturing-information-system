export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      access_permission: {
        Row: {
          allowed: boolean
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_post: boolean
          can_view: boolean
          can_void: boolean
          company_id: string
          menu_key: string
          role: string
          updated_at: string
          updated_by_user_id: string | null
          version: number
        }
        Insert: {
          allowed?: boolean
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_post?: boolean
          can_view?: boolean
          can_void?: boolean
          company_id: string
          menu_key: string
          role: string
          updated_at?: string
          updated_by_user_id?: string | null
          version?: number
        }
        Update: {
          allowed?: boolean
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_post?: boolean
          can_view?: boolean
          can_void?: boolean
          company_id?: string
          menu_key?: string
          role?: string
          updated_at?: string
          updated_by_user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "access_permission_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_mapping: {
        Row: {
          account_id: string
          company_id: string
          mapping_key: string
          updated_at: string
          version: number
        }
        Insert: {
          account_id: string
          company_id: string
          mapping_key: string
          updated_at?: string
          version?: number
        }
        Update: {
          account_id?: string
          company_id?: string
          mapping_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "accounting_mapping_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_mapping_company_account_fk"
            columns: ["company_id", "account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "accounting_mapping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_period: {
        Row: {
          close_checksum: string | null
          close_summary: Json | null
          closed_at: string | null
          closed_by_user_id: string | null
          company_id: string
          created_at: string
          end_date: string
          id: string
          opening_state: string
          period_month: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by_user_id: string | null
          start_date: string
          state: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          close_checksum?: string | null
          close_summary?: Json | null
          closed_at?: string | null
          closed_by_user_id?: string | null
          company_id: string
          created_at?: string
          end_date: string
          id?: string
          opening_state?: string
          period_month: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by_user_id?: string | null
          start_date: string
          state?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          close_checksum?: string | null
          close_summary?: Json | null
          closed_at?: string | null
          closed_by_user_id?: string | null
          company_id?: string
          created_at?: string
          end_date?: string
          id?: string
          opening_state?: string
          period_month?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by_user_id?: string | null
          start_date?: string
          state?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "accounting_period_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      app_notification: {
        Row: {
          audience_role: string
          company_id: string
          created_at: string
          deduplication_key: string
          destination: string
          event_type: string
          id: string
          message: string
          push_dispatched_at: string | null
          read_at: string | null
          recipient_user_id: string
          source_object_id: string
          source_object_type: string
          title: string
        }
        Insert: {
          audience_role: string
          company_id: string
          created_at?: string
          deduplication_key: string
          destination: string
          event_type: string
          id?: string
          message: string
          push_dispatched_at?: string | null
          read_at?: string | null
          recipient_user_id: string
          source_object_id: string
          source_object_type: string
          title: string
        }
        Update: {
          audience_role?: string
          company_id?: string
          created_at?: string
          deduplication_key?: string
          destination?: string
          event_type?: string
          id?: string
          message?: string
          push_dispatched_at?: string | null
          read_at?: string | null
          recipient_user_id?: string
          source_object_id?: string
          source_object_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_notification_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_record: {
        Row: {
          accumulated_depreciation: number
          acquisition_cost: number
          asset_code: string
          capitalization_date: string | null
          category_id: string | null
          company_id: string
          created_at: string
          custodian: string | null
          data: Json
          depreciation_method: string | null
          depreciation_start_date: string | null
          id: string
          location: string | null
          name: string
          residual_value: number
          serial_number: string | null
          source_document_id: string
          source_purchase_line_id: string | null
          status: string
          updated_at: string
          useful_life_months: number | null
        }
        Insert: {
          accumulated_depreciation?: number
          acquisition_cost: number
          asset_code: string
          capitalization_date?: string | null
          category_id?: string | null
          company_id: string
          created_at?: string
          custodian?: string | null
          data?: Json
          depreciation_method?: string | null
          depreciation_start_date?: string | null
          id?: string
          location?: string | null
          name: string
          residual_value?: number
          serial_number?: string | null
          source_document_id: string
          source_purchase_line_id?: string | null
          status?: string
          updated_at?: string
          useful_life_months?: number | null
        }
        Update: {
          accumulated_depreciation?: number
          acquisition_cost?: number
          asset_code?: string
          capitalization_date?: string | null
          category_id?: string | null
          company_id?: string
          created_at?: string
          custodian?: string | null
          data?: Json
          depreciation_method?: string | null
          depreciation_start_date?: string | null
          id?: string
          location?: string | null
          name?: string
          residual_value?: number
          serial_number?: string | null
          source_document_id?: string
          source_purchase_line_id?: string | null
          status?: string
          updated_at?: string
          useful_life_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_record_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "configuration_category"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_record_company_category_fk"
            columns: ["company_id", "category_id"]
            isOneToOne: false
            referencedRelation: "configuration_category"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "asset_record_company_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "asset_record_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_record_company_purchase_line_fk"
            columns: ["company_id", "source_purchase_line_id"]
            isOneToOne: false
            referencedRelation: "business_document_line"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "asset_record_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_record_source_purchase_line_id_fkey"
            columns: ["source_purchase_line_id"]
            isOneToOne: false
            referencedRelation: "business_document_line"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment: {
        Row: {
          checksum_sha256: string
          company_id: string
          created_at: string
          detected_mime: string
          id: string
          original_name: string
          parent_id: string
          parent_type: string
          scan_status: string
          size_bytes: number
          storage_key: string
          supersedes_id: string | null
          uploaded_by_user_id: string | null
          version: number
        }
        Insert: {
          checksum_sha256: string
          company_id: string
          created_at?: string
          detected_mime: string
          id?: string
          original_name: string
          parent_id: string
          parent_type: string
          scan_status?: string
          size_bytes: number
          storage_key: string
          supersedes_id?: string | null
          uploaded_by_user_id?: string | null
          version?: number
        }
        Update: {
          checksum_sha256?: string
          company_id?: string
          created_at?: string
          detected_mime?: string
          id?: string
          original_name?: string
          parent_id?: string
          parent_type?: string
          scan_status?: string
          size_bytes?: number
          storage_key?: string
          supersedes_id?: string | null
          uploaded_by_user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "attachment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "attachment"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          company_id: string | null
          created_at: string
          details: Json
          id: string
          object_id: string | null
          object_type: string | null
          reason: string | null
          request_id: string | null
          result: string
          target_id: string
          target_type: string
          user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          company_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          object_id?: string | null
          object_type?: string | null
          reason?: string | null
          request_id?: string | null
          result?: string
          target_id: string
          target_type: string
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          company_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          object_id?: string | null
          object_type?: string | null
          reason?: string | null
          request_id?: string | null
          result?: string
          target_id?: string
          target_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      business_document: {
        Row: {
          company_id: string
          counterparty_id: string | null
          created_at: string
          created_by_user_id: string | null
          data: Json
          document_kind: string
          document_number: string | null
          id: string
          idempotency_key: string | null
          paid_amount: number
          posted_at: string | null
          posted_by_user_id: string | null
          replacement_for_id: string | null
          source_document_id: string | null
          status: string
          total_amount: number
          transaction_date: string
          updated_at: string
          updated_by_user_id: string | null
          version: number
          void_reason: string | null
          voided_at: string | null
          voided_by_user_id: string | null
        }
        Insert: {
          company_id: string
          counterparty_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          data?: Json
          document_kind: string
          document_number?: string | null
          id?: string
          idempotency_key?: string | null
          paid_amount?: number
          posted_at?: string | null
          posted_by_user_id?: string | null
          replacement_for_id?: string | null
          source_document_id?: string | null
          status?: string
          total_amount?: number
          transaction_date: string
          updated_at?: string
          updated_by_user_id?: string | null
          version?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by_user_id?: string | null
        }
        Update: {
          company_id?: string
          counterparty_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          data?: Json
          document_kind?: string
          document_number?: string | null
          id?: string
          idempotency_key?: string | null
          paid_amount?: number
          posted_at?: string | null
          posted_by_user_id?: string | null
          replacement_for_id?: string | null
          source_document_id?: string | null
          status?: string
          total_amount?: number
          transaction_date?: string
          updated_at?: string
          updated_by_user_id?: string | null
          version?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_document_company_counterparty_fk"
            columns: ["company_id", "counterparty_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "business_document_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_document_company_replacement_fk"
            columns: ["company_id", "replacement_for_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "business_document_company_source_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "business_document_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_document_replacement_for_id_fkey"
            columns: ["replacement_for_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_document_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      business_document_line: {
        Row: {
          account_id: string | null
          company_id: string
          conversion_factor: number
          created_at: string
          data: Json
          description: string
          document_id: string
          id: string
          is_current: boolean
          item_id: string | null
          line_number: number
          quantity: number
          revision: number
          subtotal: number
          total_amount: number
          unit_code: string | null
          unit_price: number
          version: number
        }
        Insert: {
          account_id?: string | null
          company_id: string
          conversion_factor?: number
          created_at?: string
          data?: Json
          description?: string
          document_id: string
          id?: string
          is_current?: boolean
          item_id?: string | null
          line_number: number
          quantity?: number
          revision?: number
          subtotal?: number
          total_amount?: number
          unit_code?: string | null
          unit_price?: number
          version?: number
        }
        Update: {
          account_id?: string | null
          company_id?: string
          conversion_factor?: number
          created_at?: string
          data?: Json
          description?: string
          document_id?: string
          id?: string
          is_current?: boolean
          item_id?: string | null
          line_number?: number
          quantity?: number
          revision?: number
          subtotal?: number
          total_amount?: number
          unit_code?: string | null
          unit_price?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_document_line_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_document_line_company_account_fk"
            columns: ["company_id", "account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "business_document_line_company_document_fk"
            columns: ["company_id", "document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "business_document_line_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_document_line_company_item_fk"
            columns: ["company_id", "item_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "business_document_line_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_document_line_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movement: {
        Row: {
          amount: number
          cash_account_id: string
          company_id: string
          created_at: string
          id: string
          movement_type: string
          notes: string | null
          paired_movement_id: string | null
          posted_at: string
          reference_document_id: string | null
          reversal_of_id: string | null
          source_document_id: string | null
          transaction_date: string
        }
        Insert: {
          amount: number
          cash_account_id: string
          company_id: string
          created_at?: string
          id?: string
          movement_type?: string
          notes?: string | null
          paired_movement_id?: string | null
          posted_at?: string
          reference_document_id?: string | null
          reversal_of_id?: string | null
          source_document_id?: string | null
          transaction_date?: string
        }
        Update: {
          amount?: number
          cash_account_id?: string
          company_id?: string
          created_at?: string
          id?: string
          movement_type?: string
          notes?: string | null
          paired_movement_id?: string | null
          posted_at?: string
          reference_document_id?: string | null
          reversal_of_id?: string | null
          source_document_id?: string | null
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movement_cash_account_id_fkey"
            columns: ["cash_account_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movement_company_account_fk"
            columns: ["company_id", "cash_account_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "cash_movement_company_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "cash_movement_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movement_paired_movement_id_fkey"
            columns: ["paired_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movement_reference_document_id_fkey"
            columns: ["reference_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movement_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "cash_movement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movement_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      company: {
        Row: {
          address: string | null
          code: string
          code_locked: boolean
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          logo_storage_key: string | null
          name: string
          phone: string | null
          updated_at: string
          version: number
        }
        Insert: {
          address?: string | null
          code: string
          code_locked?: boolean
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          logo_storage_key?: string | null
          name: string
          phone?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          address?: string | null
          code?: string
          code_locked?: boolean
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          logo_storage_key?: string | null
          name?: string
          phone?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      configuration_category: {
        Row: {
          category_kind: string
          code: string
          company_id: string
          created_at: string
          defaults: Json
          id: string
          is_active: boolean
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          category_kind: string
          code: string
          company_id: string
          created_at?: string
          defaults?: Json
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          category_kind?: string
          code?: string
          company_id?: string
          created_at?: string
          defaults?: Json
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "configuration_category_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      depreciation_entry: {
        Row: {
          amount: number
          asset_id: string
          company_id: string
          id: string
          period_month: string
          posted_at: string
          reversal_of_id: string | null
          source_document_id: string
        }
        Insert: {
          amount: number
          asset_id: string
          company_id: string
          id?: string
          period_month: string
          posted_at?: string
          reversal_of_id?: string | null
          source_document_id: string
        }
        Update: {
          amount?: number
          asset_id?: string
          company_id?: string
          id?: string
          period_month?: string
          posted_at?: string
          reversal_of_id?: string | null
          source_document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "depreciation_entry_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "asset_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_entry_company_asset_fk"
            columns: ["company_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "asset_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "depreciation_entry_company_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "depreciation_entry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_entry_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "depreciation_entry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_entry_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequence: {
        Row: {
          company_id: string
          current_number: number
          current_value: number
          document_kind: string | null
          padding: number
          period_key: string | null
          prefix: string
          sequence_key: string
          updated_at: string
          version: number
        }
        Insert: {
          company_id: string
          current_number?: number
          current_value?: number
          document_kind?: string | null
          padding?: number
          period_key?: string | null
          prefix?: string
          sequence_key: string
          updated_at?: string
          version?: number
        }
        Update: {
          company_id?: string
          current_number?: number
          current_value?: number
          document_kind?: string | null
          padding?: number
          period_key?: string | null
          prefix?: string
          sequence_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_sequence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movement: {
        Row: {
          business_date: string
          company_id: string
          created_at: string
          id: string
          inventory_state: string
          item_id: string
          lot_code: string | null
          movement_type: string | null
          notes: string | null
          posted_at: string
          quantity: number
          receipt_snapshot: Json
          reference_document_id: string | null
          reversal_of_id: string | null
          source_document_id: string | null
          source_line_id: string | null
          total_cost: number
          transaction_date: string
          unit_cost: number
        }
        Insert: {
          business_date?: string
          company_id: string
          created_at?: string
          id?: string
          inventory_state?: string
          item_id: string
          lot_code?: string | null
          movement_type?: string | null
          notes?: string | null
          posted_at?: string
          quantity: number
          receipt_snapshot?: Json
          reference_document_id?: string | null
          reversal_of_id?: string | null
          source_document_id?: string | null
          source_line_id?: string | null
          total_cost?: number
          transaction_date?: string
          unit_cost?: number
        }
        Update: {
          business_date?: string
          company_id?: string
          created_at?: string
          id?: string
          inventory_state?: string
          item_id?: string
          lot_code?: string | null
          movement_type?: string | null
          notes?: string | null
          posted_at?: string
          quantity?: number
          receipt_snapshot?: Json
          reference_document_id?: string | null
          reversal_of_id?: string | null
          source_document_id?: string | null
          source_line_id?: string | null
          total_cost?: number
          transaction_date?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movement_company_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "inventory_movement_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movement_company_item_fk"
            columns: ["company_id", "item_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "inventory_movement_company_line_fk"
            columns: ["company_id", "source_line_id"]
            isOneToOne: false
            referencedRelation: "business_document_line"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "inventory_movement_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movement_reference_document_id_fkey"
            columns: ["reference_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movement_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "inventory_movement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movement_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movement_source_line_id_fkey"
            columns: ["source_line_id"]
            isOneToOne: false
            referencedRelation: "business_document_line"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry: {
        Row: {
          company_id: string
          created_at: string
          description: string
          entry_number: string
          entry_type: string
          id: string
          is_closing_entry: boolean
          memo: string
          period_id: string | null
          posted_at: string
          reference_document_id: string | null
          reversal_of_id: string | null
          source_document_id: string | null
          status: string
          transaction_date: string
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string
          entry_number: string
          entry_type?: string
          id?: string
          is_closing_entry?: boolean
          memo?: string
          period_id?: string | null
          posted_at?: string
          reference_document_id?: string | null
          reversal_of_id?: string | null
          source_document_id?: string | null
          status?: string
          transaction_date: string
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string
          entry_number?: string
          entry_type?: string
          id?: string
          is_closing_entry?: boolean
          memo?: string
          period_id?: string | null
          posted_at?: string
          reference_document_id?: string | null
          reversal_of_id?: string | null
          source_document_id?: string | null
          status?: string
          transaction_date?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_company_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "journal_entry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_company_period_fk"
            columns: ["company_id", "period_id"]
            isOneToOne: false
            referencedRelation: "accounting_period"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "journal_entry_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_period"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_reference_document_id_fkey"
            columns: ["reference_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "journal_entry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_line: {
        Row: {
          account_id: string
          company_id: string
          credit: number
          credit_amount: number
          debit: number
          debit_amount: number
          description: string | null
          id: string
          journal_entry_id: string
          line_number: number
          subledger_id: string | null
          subledger_type: string | null
        }
        Insert: {
          account_id: string
          company_id: string
          credit?: number
          credit_amount?: number
          debit?: number
          debit_amount?: number
          description?: string | null
          id?: string
          journal_entry_id: string
          line_number: number
          subledger_id?: string | null
          subledger_type?: string | null
        }
        Update: {
          account_id?: string
          company_id?: string
          credit?: number
          credit_amount?: number
          debit?: number
          debit_amount?: number
          description?: string | null
          id?: string
          journal_entry_id?: string
          line_number?: number
          subledger_id?: string | null
          subledger_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_line_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_line_company_account_fk"
            columns: ["company_id", "account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "journal_line_company_entry_fk"
            columns: ["company_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entry"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "journal_line_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_line_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entry"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_account: {
        Row: {
          account_type: string
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_control: boolean
          level1: string
          level2: string
          level3: string
          monthly_calculation: string
          name: string
          normal_balance: string
          report_sign: string
          updated_at: string
          version: number
        }
        Insert: {
          account_type: string
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_control?: boolean
          level1: string
          level2?: string
          level3?: string
          monthly_calculation: string
          name: string
          normal_balance: string
          report_sign: string
          updated_at?: string
          version?: number
        }
        Update: {
          account_type?: string
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_control?: boolean
          level1?: string
          level2?: string
          level3?: string
          monthly_calculation?: string
          name?: string
          normal_balance?: string
          report_sign?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ledger_account_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      master_record: {
        Row: {
          code: string | null
          company_id: string
          created_at: string
          created_by_user_id: string | null
          data: Json
          id: string
          is_active: boolean
          ledger_account_id: string | null
          name: string
          record_kind: string
          sku: string | null
          updated_at: string
          updated_by_user_id: string | null
          version: number
        }
        Insert: {
          code?: string | null
          company_id: string
          created_at?: string
          created_by_user_id?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          ledger_account_id?: string | null
          name: string
          record_kind: string
          sku?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          version?: number
        }
        Update: {
          code?: string | null
          company_id?: string
          created_at?: string
          created_by_user_id?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          ledger_account_id?: string | null
          name?: string
          record_kind?: string
          sku?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "master_record_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_record_company_ledger_account_fk"
            columns: ["company_id", "ledger_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "master_record_ledger_account_id_fkey"
            columns: ["ledger_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["id"]
          },
        ]
      }
      negative_stock_exception: {
        Row: {
          company_id: string
          createdat: string
          id: string
          inventory_state: string
          item_id: string
          resolved_by_document_id: string | null
          resolvedat: string | null
          shortage_quantity: number
          source_document_id: string
          status: string
        }
        Insert: {
          company_id: string
          createdat?: string
          id?: string
          inventory_state: string
          item_id: string
          resolved_by_document_id?: string | null
          resolvedat?: string | null
          shortage_quantity: number
          source_document_id: string
          status?: string
        }
        Update: {
          company_id?: string
          createdat?: string
          id?: string
          inventory_state?: string
          item_id?: string
          resolved_by_document_id?: string | null
          resolvedat?: string | null
          shortage_quantity?: number
          source_document_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "negative_stock_exception_company_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "negative_stock_exception_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negative_stock_exception_company_item_fk"
            columns: ["company_id", "item_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "negative_stock_exception_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negative_stock_exception_resolved_by_document_id_fkey"
            columns: ["resolved_by_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negative_stock_exception_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      prepaid_amortization_entry: {
        Row: {
          amount: number
          company_id: string
          id: string
          period_month: string
          posted_at: string
          prepaid_expense_id: string
          source_document_id: string
        }
        Insert: {
          amount: number
          company_id: string
          id?: string
          period_month: string
          posted_at?: string
          prepaid_expense_id: string
          source_document_id: string
        }
        Update: {
          amount?: number
          company_id?: string
          id?: string
          period_month?: string
          posted_at?: string
          prepaid_expense_id?: string
          source_document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prepaid_amortization_company_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "prepaid_amortization_company_schedule_fk"
            columns: ["company_id", "prepaid_expense_id"]
            isOneToOne: false
            referencedRelation: "prepaid_expense"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "prepaid_amortization_entry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepaid_amortization_entry_prepaid_expense_id_fkey"
            columns: ["prepaid_expense_id"]
            isOneToOne: false
            referencedRelation: "prepaid_expense"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepaid_amortization_entry_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      prepaid_expense: {
        Row: {
          amortized_amount: number
          company_id: string
          created_at: string
          description: string
          end_date: string
          expense_account_id: string
          id: string
          number_of_months: number
          original_amount: number
          prepaid_account_id: string
          start_date: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          amortized_amount?: number
          company_id: string
          created_at?: string
          description: string
          end_date: string
          expense_account_id: string
          id?: string
          number_of_months: number
          original_amount: number
          prepaid_account_id: string
          start_date: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          amortized_amount?: number
          company_id?: string
          created_at?: string
          description?: string
          end_date?: string
          expense_account_id?: string
          id?: string
          number_of_months?: number
          original_amount?: number
          prepaid_account_id?: string
          start_date?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prepaid_expense_company_expense_account_fk"
            columns: ["company_id", "expense_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "prepaid_expense_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepaid_expense_company_prepaid_account_fk"
            columns: ["company_id", "prepaid_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "prepaid_expense_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prepaid_expense_prepaid_account_id_fkey"
            columns: ["prepaid_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["id"]
          },
        ]
      }
      production_bundle: {
        Row: {
          active_quantity: number
          bundle_code: string
          company_id: string
          created_at: string
          cutting_lot_id: string
          final_rejected_quantity: number
          id: string
          initial_quantity: number
          last_actual_work_order_id: string | null
          product_id: string
          production_order_id: string
          stage: string
          updated_at: string
          work_condition: string
        }
        Insert: {
          active_quantity: number
          bundle_code: string
          company_id: string
          created_at?: string
          cutting_lot_id: string
          final_rejected_quantity?: number
          id?: string
          initial_quantity: number
          last_actual_work_order_id?: string | null
          product_id: string
          production_order_id: string
          stage?: string
          updated_at?: string
          work_condition?: string
        }
        Update: {
          active_quantity?: number
          bundle_code?: string
          company_id?: string
          created_at?: string
          cutting_lot_id?: string
          final_rejected_quantity?: number
          id?: string
          initial_quantity?: number
          last_actual_work_order_id?: string | null
          product_id?: string
          production_order_id?: string
          stage?: string
          updated_at?: string
          work_condition?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_bundle_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_bundle_company_last_actual_work_order_fk"
            columns: ["company_id", "last_actual_work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["company_id", "document_id"]
          },
          {
            foreignKeyName: "production_bundle_company_lot_fk"
            columns: ["company_id", "cutting_lot_id"]
            isOneToOne: false
            referencedRelation: "production_cutting_lot"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_bundle_company_order_fk"
            columns: ["company_id", "production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_bundle_company_product_fk"
            columns: ["company_id", "product_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_bundle_cutting_lot_id_fkey"
            columns: ["cutting_lot_id"]
            isOneToOne: false
            referencedRelation: "production_cutting_lot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_bundle_last_actual_work_order_id_fkey"
            columns: ["last_actual_work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "production_bundle_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_bundle_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      production_bundle_reservation: {
        Row: {
          bundle_id: string
          company_id: string
          reserved_at: string
          work_order_id: string
        }
        Insert: {
          bundle_id: string
          company_id: string
          reserved_at?: string
          work_order_id: string
        }
        Update: {
          bundle_id?: string
          company_id?: string
          reserved_at?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_bundle_reservation_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: true
            referencedRelation: "production_bundle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_bundle_reservation_company_bundle_fk"
            columns: ["company_id", "bundle_id"]
            isOneToOne: false
            referencedRelation: "production_bundle"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_bundle_reservation_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_bundle_reservation_company_order_fk"
            columns: ["company_id", "work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["company_id", "document_id"]
          },
          {
            foreignKeyName: "production_bundle_reservation_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["document_id"]
          },
        ]
      }
      production_bundle_stage_result: {
        Row: {
          actual_document_id: string
          bundle_id: string
          company_id: string
          created_at: string
          final_rejected_quantity: number
          id: string
          production_order_id: string
          repair_quantity: number
          stage: string
          success_quantity: number
          work_order_id: string
          worked_quantity: number
        }
        Insert: {
          actual_document_id: string
          bundle_id: string
          company_id: string
          created_at?: string
          final_rejected_quantity: number
          id?: string
          production_order_id: string
          repair_quantity: number
          stage: string
          success_quantity: number
          work_order_id: string
          worked_quantity: number
        }
        Update: {
          actual_document_id?: string
          bundle_id?: string
          company_id?: string
          created_at?: string
          final_rejected_quantity?: number
          id?: string
          production_order_id?: string
          repair_quantity?: number
          stage?: string
          success_quantity?: number
          work_order_id?: string
          worked_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_bundle_stage_result_actual_document_id_fkey"
            columns: ["actual_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_bundle_stage_result_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "production_bundle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_bundle_stage_result_company_actual_fk"
            columns: ["company_id", "actual_document_id"]
            isOneToOne: true
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_bundle_stage_result_company_bundle_fk"
            columns: ["company_id", "bundle_id"]
            isOneToOne: false
            referencedRelation: "production_bundle"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_bundle_stage_result_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_bundle_stage_result_company_order_fk"
            columns: ["company_id", "production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_bundle_stage_result_company_work_order_fk"
            columns: ["company_id", "work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["company_id", "document_id"]
          },
          {
            foreignKeyName: "production_bundle_stage_result_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_bundle_stage_result_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["document_id"]
          },
        ]
      }
      production_cutting_lot: {
        Row: {
          company_id: string
          created_at: string
          cutting_work_order_id: string
          id: string
          lot_code: string
          physical_material_unit_id: string | null
          production_order_id: string
          source_actual_document_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          cutting_work_order_id: string
          id?: string
          lot_code: string
          physical_material_unit_id?: string | null
          production_order_id: string
          source_actual_document_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          cutting_work_order_id?: string
          id?: string
          lot_code?: string
          physical_material_unit_id?: string | null
          production_order_id?: string
          source_actual_document_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_cutting_lot_company_actual_document_fk"
            columns: ["company_id", "source_actual_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_cutting_lot_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_cutting_lot_company_order_fk"
            columns: ["company_id", "production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_cutting_lot_company_physical_unit_fk"
            columns: ["company_id", "physical_material_unit_id"]
            isOneToOne: false
            referencedRelation: "production_material_unit"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_cutting_lot_cutting_work_order_id_fkey"
            columns: ["cutting_work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "production_cutting_lot_physical_material_unit_id_fkey"
            columns: ["physical_material_unit_id"]
            isOneToOne: false
            referencedRelation: "production_material_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_cutting_lot_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_cutting_lot_source_actual_document_id_fkey"
            columns: ["source_actual_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      production_material_unit: {
        Row: {
          company_id: string
          consumed_at: string | null
          consumed_by_document_id: string | null
          created_at: string
          id: string
          initial_base_quantity: number
          material_id: string
          packaging_unit_code: string
          physical_code: string
          receipt_cycle: number
          source_document_id: string
          source_line_id: string
          status: string
          stock_unit_code: string
        }
        Insert: {
          company_id: string
          consumed_at?: string | null
          consumed_by_document_id?: string | null
          created_at?: string
          id?: string
          initial_base_quantity: number
          material_id: string
          packaging_unit_code: string
          physical_code: string
          receipt_cycle: number
          source_document_id: string
          source_line_id: string
          status?: string
          stock_unit_code: string
        }
        Update: {
          company_id?: string
          consumed_at?: string | null
          consumed_by_document_id?: string | null
          created_at?: string
          id?: string
          initial_base_quantity?: number
          material_id?: string
          packaging_unit_code?: string
          physical_code?: string
          receipt_cycle?: number
          source_document_id?: string
          source_line_id?: string
          status?: string
          stock_unit_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_material_unit_company_consumed_document_fk"
            columns: ["company_id", "consumed_by_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_material_unit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_material_unit_company_material_fk"
            columns: ["company_id", "material_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_material_unit_company_source_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_material_unit_company_source_line_fk"
            columns: ["company_id", "source_line_id"]
            isOneToOne: false
            referencedRelation: "business_document_line"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_material_unit_consumed_by_document_id_fkey"
            columns: ["consumed_by_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_material_unit_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_material_unit_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_material_unit_source_line_id_fkey"
            columns: ["source_line_id"]
            isOneToOne: false
            referencedRelation: "business_document_line"
            referencedColumns: ["id"]
          },
        ]
      }
      production_operator_profile: {
        Row: {
          company_id: string
          created_at: string
          employee_id: string
          id: string
          is_active: boolean
          operator_role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          is_active?: boolean
          operator_role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          is_active?: boolean
          operator_role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_operator_profile_company_employee_fk"
            columns: ["company_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_operator_profile_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_operator_profile_company_user_fk"
            columns: ["company_id", "user_id"]
            isOneToOne: false
            referencedRelation: "user_company_assignment"
            referencedColumns: ["company_id", "user_id"]
          },
          {
            foreignKeyName: "production_operator_profile_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
        ]
      }
      production_printing_operator: {
        Row: {
          company_id: string
          operator_profile_id: string
          product_id: string
          production_order_id: string
        }
        Insert: {
          company_id: string
          operator_profile_id: string
          product_id: string
          production_order_id: string
        }
        Update: {
          company_id?: string
          operator_profile_id?: string
          product_id?: string
          production_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_printing_operator_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_printing_operator_company_order_fk"
            columns: ["company_id", "production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_printing_operator_company_product_fk"
            columns: ["company_id", "product_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_printing_operator_operator_profile_id_fkey"
            columns: ["operator_profile_id"]
            isOneToOne: false
            referencedRelation: "production_operator_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_printing_operator_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_printing_operator_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      production_product_routing: {
        Row: {
          company_id: string
          configured_at: string
          configured_by_user_id: string | null
          product_id: string
          requires_printing: boolean
        }
        Insert: {
          company_id: string
          configured_at?: string
          configured_by_user_id?: string | null
          product_id: string
          requires_printing: boolean
        }
        Update: {
          company_id?: string
          configured_at?: string
          configured_by_user_id?: string | null
          product_id?: string
          requires_printing?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "production_product_routing_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_product_routing_company_product_fk"
            columns: ["company_id", "product_id"]
            isOneToOne: true
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_product_routing_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
        ]
      }
      production_repair_case: {
        Row: {
          bundle_id: string
          business_status: string
          company_id: string
          compensation_mode: string | null
          created_at: string
          found_at_stage: string
          id: string
          issue_reason: string
          production_order_id: string
          quantity: number
          rate_snapshot: number | null
          repair_work_kind: string
          repair_work_order_id: string | null
          source_work_order_id: string
          updated_at: string
        }
        Insert: {
          bundle_id: string
          business_status?: string
          company_id: string
          compensation_mode?: string | null
          created_at?: string
          found_at_stage: string
          id?: string
          issue_reason: string
          production_order_id: string
          quantity: number
          rate_snapshot?: number | null
          repair_work_kind: string
          repair_work_order_id?: string | null
          source_work_order_id: string
          updated_at?: string
        }
        Update: {
          bundle_id?: string
          business_status?: string
          company_id?: string
          compensation_mode?: string | null
          created_at?: string
          found_at_stage?: string
          id?: string
          issue_reason?: string
          production_order_id?: string
          quantity?: number
          rate_snapshot?: number | null
          repair_work_kind?: string
          repair_work_order_id?: string | null
          source_work_order_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_repair_case_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "production_bundle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_repair_case_company_bundle_fk"
            columns: ["company_id", "bundle_id"]
            isOneToOne: false
            referencedRelation: "production_bundle"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_repair_case_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_repair_case_company_order_fk"
            columns: ["company_id", "production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_repair_case_company_source_fk"
            columns: ["company_id", "source_work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["company_id", "document_id"]
          },
          {
            foreignKeyName: "production_repair_case_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_repair_case_repair_work_order_id_fkey"
            columns: ["repair_work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "production_repair_case_source_work_order_id_fkey"
            columns: ["source_work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["document_id"]
          },
        ]
      }
      production_work_order: {
        Row: {
          assigned_at: string | null
          assigned_by_user_id: string | null
          business_status: string
          cancellation_reason: string | null
          company_id: string
          created_at: string
          document_id: string
          operator_profile_id: string
          production_order_id: string
          stage: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by_user_id?: string | null
          business_status?: string
          cancellation_reason?: string | null
          company_id: string
          created_at?: string
          document_id: string
          operator_profile_id: string
          production_order_id: string
          stage: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by_user_id?: string | null
          business_status?: string
          cancellation_reason?: string | null
          company_id?: string
          created_at?: string
          document_id?: string
          operator_profile_id?: string
          production_order_id?: string
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_work_order_company_document_fk"
            columns: ["company_id", "document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_work_order_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_work_order_company_parent_fk"
            columns: ["company_id", "production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_work_order_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_work_order_operator_profile_id_fkey"
            columns: ["operator_profile_id"]
            isOneToOne: false
            referencedRelation: "production_operator_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_work_order_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      production_work_order_bundle: {
        Row: {
          bundle_id: string
          company_id: string
          work_order_id: string
        }
        Insert: {
          bundle_id: string
          company_id: string
          work_order_id: string
        }
        Update: {
          bundle_id?: string
          company_id?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_work_order_bundle_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "production_bundle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_work_order_bundle_company_bundle_fk"
            columns: ["company_id", "bundle_id"]
            isOneToOne: false
            referencedRelation: "production_bundle"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "production_work_order_bundle_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_work_order_bundle_company_order_fk"
            columns: ["company_id", "work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["company_id", "document_id"]
          },
          {
            foreignKeyName: "production_work_order_bundle_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "production_work_order"
            referencedColumns: ["document_id"]
          },
        ]
      }
      report_account_mapping: {
        Row: {
          account_id: string
          cash_flow_activity: string | null
          cash_flow_group: string | null
          company_id: string
          management_post: string
          updated_at: string
          version: number
        }
        Insert: {
          account_id: string
          cash_flow_activity?: string | null
          cash_flow_group?: string | null
          company_id: string
          management_post: string
          updated_at?: string
          version?: number
        }
        Update: {
          account_id?: string
          cash_flow_activity?: string | null
          cash_flow_group?: string | null
          company_id?: string
          management_post?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_account_mapping_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_account_mapping_company_account_fk"
            columns: ["company_id", "account_id"]
            isOneToOne: true
            referencedRelation: "ledger_account"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "report_account_mapping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      subledger_entry: {
        Row: {
          amount: number
          company_id: string
          counterparty_id: string | null
          created_at: string
          credit_amount: number
          debit_amount: number
          document_id: string | null
          id: string
          posted_at: string
          reference_id: string | null
          remaining_balance: number
          reversal_of_id: string | null
          source_document_id: string | null
          status: string
          subledger_kind: string
          subledger_type: string
          transaction_date: string
          version: number
        }
        Insert: {
          amount?: number
          company_id: string
          counterparty_id?: string | null
          created_at?: string
          credit_amount?: number
          debit_amount?: number
          document_id?: string | null
          id?: string
          posted_at?: string
          reference_id?: string | null
          remaining_balance?: number
          reversal_of_id?: string | null
          source_document_id?: string | null
          status?: string
          subledger_kind?: string
          subledger_type?: string
          transaction_date?: string
          version?: number
        }
        Update: {
          amount?: number
          company_id?: string
          counterparty_id?: string | null
          created_at?: string
          credit_amount?: number
          debit_amount?: number
          document_id?: string | null
          id?: string
          posted_at?: string
          reference_id?: string | null
          remaining_balance?: number
          reversal_of_id?: string | null
          source_document_id?: string | null
          status?: string
          subledger_kind?: string
          subledger_type?: string
          transaction_date?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "subledger_entry_company_counterparty_fk"
            columns: ["company_id", "counterparty_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "subledger_entry_company_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "subledger_entry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subledger_entry_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subledger_entry_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subledger_entry_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "subledger_entry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subledger_entry_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_definition: {
        Row: {
          code: string
          company_id: string
          created_at: string
          decimal_scale: number
          id: string | null
          is_active: boolean
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          decimal_scale?: number
          id?: string | null
          is_active?: boolean
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          decimal_scale?: number
          id?: string | null
          is_active?: boolean
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "unit_definition_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      user_company_assignment: {
        Row: {
          company_id: string
          created_at: string
          is_active: boolean
          roles: string[]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          is_active?: boolean
          roles?: string[]
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          is_active?: boolean
          roles?: string[]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_company_assignment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
        ]
      }
      wage_liability: {
        Row: {
          company_id: string
          employee_id: string
          gross_amount: number
          id: string
          item_id: string | null
          paid_amount: number
          posted_at: string
          quantity: number
          rate: number
          reversal_of_id: string | null
          service_kind: string
          source_document_id: string
          source_line_id: string | null
        }
        Insert: {
          company_id: string
          employee_id: string
          gross_amount: number
          id?: string
          item_id?: string | null
          paid_amount?: number
          posted_at?: string
          quantity: number
          rate: number
          reversal_of_id?: string | null
          service_kind: string
          source_document_id: string
          source_line_id?: string | null
        }
        Update: {
          company_id?: string
          employee_id?: string
          gross_amount?: number
          id?: string
          item_id?: string | null
          paid_amount?: number
          posted_at?: string
          quantity?: number
          rate?: number
          reversal_of_id?: string | null
          service_kind?: string
          source_document_id?: string
          source_line_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wage_liability_company_document_fk"
            columns: ["company_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "wage_liability_company_employee_fk"
            columns: ["company_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "wage_liability_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_liability_company_item_fk"
            columns: ["company_id", "item_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "wage_liability_company_line_fk"
            columns: ["company_id", "source_line_id"]
            isOneToOne: false
            referencedRelation: "business_document_line"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "wage_liability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_liability_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_liability_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "wage_liability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_liability_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "business_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_liability_source_line_id_fkey"
            columns: ["source_line_id"]
            isOneToOne: false
            referencedRelation: "business_document_line"
            referencedColumns: ["id"]
          },
        ]
      }
      wage_rate: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by_user_id: string | null
          id: string
          product_id: string
          rate: number
          service_kind: string
          updated_at: string
          updated_by_user_id: string | null
          version: number
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          product_id: string
          rate: number
          service_kind: string
          updated_at?: string
          updated_by_user_id?: string | null
          version?: number
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          product_id?: string
          rate?: number
          service_kind?: string
          updated_at?: string
          updated_by_user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "wage_rate_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_rate_company_product_fk"
            columns: ["company_id", "product_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "wage_rate_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "master_record"
            referencedColumns: ["id"]
          },
        ]
      }
      web_push_subscription: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          expiration_time: number | null
          failure_count: number
          id: string
          is_active: boolean
          last_failure_at: string | null
          last_success_at: string | null
          p256dh: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          expiration_time?: number | null
          failure_count?: number
          id?: string
          is_active?: boolean
          last_failure_at?: string | null
          last_success_at?: string | null
          p256dh: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          expiration_time?: number | null
          failure_count?: number
          id?: string
          is_active?: boolean
          last_failure_at?: string | null
          last_success_at?: string | null
          p256dh?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_current_company_id: { Args: never; Returns: string }
      app_current_user_id: { Args: never; Returns: string }
      bootstrap_company_data: {
        Args: { p_company_id: string; p_creator_user_id: string }
        Returns: undefined
      }
      get_company_users_with_profiles: {
        Args: { p_company_id: string }
        Returns: {
          company_id: string
          created_at: string
          email: string
          full_name: string
          is_active: boolean
          roles: string[]
          updated_at: string
          user_id: string
          username: string
          version: number
        }[]
      }
      get_user_company_ids: { Args: { p_user_id: string }; Returns: string[] }
      is_company_owner: {
        Args: { p_company_id: string; p_user_id: string }
        Returns: boolean
      }
      list_available_system_users: {
        Args: never
        Returns: {
          email: string
          full_name: string
          user_id: string
          username: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

