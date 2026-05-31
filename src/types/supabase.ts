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
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      campaigns: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: number
          keywords: string[] | null
          name: string
          reference_vector: string | null
          reply_to_email: string | null
          slug: string
          status: string | null
          technical_email: string | null
          updated_at: string | null
          vector_updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: number
          keywords?: string[] | null
          name: string
          reference_vector?: string | null
          reply_to_email?: string | null
          slug: string
          status?: string | null
          technical_email?: string | null
          updated_at?: string | null
          vector_updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: number
          keywords?: string[] | null
          name?: string
          reference_vector?: string | null
          reply_to_email?: string | null
          slug?: string
          status?: string | null
          technical_email?: string | null
          updated_at?: string | null
          vector_updated_at?: string | null
        }
        Relationships: []
      }
      message_clusters: {
        Row: {
          campaign_id: number | null
          centroid_vector: string | null
          created_at: string | null
          id: number
          message_count: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          campaign_id?: number | null
          centroid_vector?: string | null
          created_at?: string | null
          id?: number
          message_count?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          campaign_id?: number | null
          centroid_vector?: string | null
          created_at?: string | null
          id?: number
          message_count?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_clusters_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_with_extra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_clusters_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      message_contacts: {
        Row: {
          contact_captured_at: string
          created_at: string | null
          id: number
          message_id: number
          purged_at: string | null
          reply_sent: boolean | null
          sender_email: string
          sender_hash: string
          sender_name: string | null
        }
        Insert: {
          contact_captured_at?: string
          created_at?: string | null
          id?: number
          message_id: number
          purged_at?: string | null
          reply_sent?: boolean | null
          sender_email: string
          sender_hash: string
          sender_name?: string | null
        }
        Update: {
          contact_captured_at?: string
          created_at?: string | null
          id?: number
          message_id?: number
          purged_at?: string | null
          reply_sent?: boolean | null
          sender_email?: string
          sender_hash?: string
          sender_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_contacts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          campaign_id: number | null
          channel: string
          channel_source: string | null
          classification_confidence: number | null
          cluster_id: number | null
          duplicate_rank: number | null
          external_id: string
          id: number
          language: string | null
          message_embedding: string | null
          politician_id: number
          processed_at: string | null
          processing_status: string | null
          received_at: string
          reply_failure_reason: string | null
          reply_last_retry_at: string | null
          reply_retry_count: number | null
          reply_scheduled_at: string | null
          reply_sent_at: string | null
          reply_template_id: number | null
          sender_country: string | null
          sender_flag: string | null
          sender_hash: string
          stalwart_account_id: string | null
          stalwart_message_id: string | null
        }
        Insert: {
          campaign_id?: number | null
          channel: string
          channel_source?: string | null
          classification_confidence?: number | null
          cluster_id?: number | null
          duplicate_rank?: number | null
          external_id: string
          id?: number
          language?: string | null
          message_embedding?: string | null
          politician_id: number
          processed_at?: string | null
          processing_status?: string | null
          received_at: string
          reply_failure_reason?: string | null
          reply_last_retry_at?: string | null
          reply_retry_count?: number | null
          reply_scheduled_at?: string | null
          reply_sent_at?: string | null
          reply_template_id?: number | null
          sender_country?: string | null
          sender_flag?: string | null
          sender_hash: string
          stalwart_account_id?: string | null
          stalwart_message_id?: string | null
        }
        Update: {
          campaign_id?: number | null
          channel?: string
          channel_source?: string | null
          classification_confidence?: number | null
          cluster_id?: number | null
          duplicate_rank?: number | null
          external_id?: string
          id?: number
          language?: string | null
          message_embedding?: string | null
          politician_id?: number
          processed_at?: string | null
          processing_status?: string | null
          received_at?: string
          reply_failure_reason?: string | null
          reply_last_retry_at?: string | null
          reply_retry_count?: number | null
          reply_scheduled_at?: string | null
          reply_sent_at?: string | null
          reply_template_id?: number | null
          sender_country?: string | null
          sender_flag?: string | null
          sender_hash?: string
          stalwart_account_id?: string | null
          stalwart_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_with_extra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "message_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_staff: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: number
          permissions: string[] | null
          politician_id: number
          role: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: number
          permissions?: string[] | null
          politician_id: number
          role?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: number
          permissions?: string[] | null
          politician_id?: number
          role?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_staff_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
        ]
      }
      politician_staff: {
        Row: {
          created_at: string
          politician_id: number
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          politician_id: number
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          politician_id?: number
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "politician_staff_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
        ]
      }
      politicians: {
        Row: {
          active: boolean | null
          additional_emails: string[] | null
          country: string | null
          created_at: string | null
          email: string
          external_id: string | null
          id: number
          level: string | null
          name: string
          party: string | null
          position: string | null
          region: string | null
          reply_to: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          additional_emails?: string[] | null
          country?: string | null
          created_at?: string | null
          email: string
          external_id?: string | null
          id?: number
          level?: string | null
          name: string
          party?: string | null
          position?: string | null
          region?: string | null
          reply_to?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          additional_emails?: string[] | null
          country?: string | null
          created_at?: string | null
          email?: string
          external_id?: string | null
          id?: number
          level?: string | null
          name?: string
          party?: string | null
          position?: string | null
          region?: string | null
          reply_to?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          firstname: string | null
          id: string
          job_title: string | null
          lastname: string | null
        }
        Insert: {
          created_at?: string | null
          firstname?: string | null
          id: string
          job_title?: string | null
          lastname?: string | null
        }
        Update: {
          created_at?: string | null
          firstname?: string | null
          id?: string
          job_title?: string | null
          lastname?: string | null
        }
        Relationships: []
      }
      reply_templates: {
        Row: {
          active: boolean | null
          body: string
          campaign_id: number
          created_at: string | null
          id: number
          layout_type: string | null
          name: string
          politician_id: number
          scheduled_for: string | null
          send_timing: string | null
          subject: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          body: string
          campaign_id: number
          created_at?: string | null
          id?: number
          layout_type?: string | null
          name: string
          politician_id: number
          scheduled_for?: string | null
          send_timing?: string | null
          subject: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          body?: string
          campaign_id?: number
          created_at?: string | null
          id?: number
          layout_type?: string | null
          name?: string
          politician_id?: number
          scheduled_for?: string | null
          send_timing?: string | null
          subject?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reply_templates_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_with_extra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reply_templates_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reply_templates_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
        ]
      }
      supporters: {
        Row: {
          campaign_id: number
          created_at: string | null
          first_message_at: string | null
          id: number
          last_message_at: string | null
          message_count: number | null
          politician_id: number
          sender_hash: string
          updated_at: string | null
        }
        Insert: {
          campaign_id: number
          created_at?: string | null
          first_message_at?: string | null
          id?: number
          last_message_at?: string | null
          message_count?: number | null
          politician_id: number
          sender_hash: string
          updated_at?: string | null
        }
        Update: {
          campaign_id?: number
          created_at?: string | null
          first_message_at?: string | null
          id?: number
          last_message_at?: string | null
          message_count?: number | null
          politician_id?: number
          sender_hash?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supporters_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_with_extra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supporters_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supporters_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      campaign_with_extra: {
        Row: {
          active_reply_template_count: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          has_reply_template: boolean | null
          id: number | null
          keywords: string[] | null
          message_count: number | null
          name: string | null
          reference_vector: string | null
          reply_template_count: number | null
          slug: string | null
          status: string | null
          template_id: number | null
          updated_at: string | null
          vector_updated_at: string | null
        }
        Relationships: []
      }
      message_analytics_view: {
        Row: {
          campaign_id: number | null
          campaign_name: string | null
          date: string | null
          message_count: number | null
          politician_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_with_extra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
        ]
      }
      message_analytics_weekly_view: {
        Row: {
          campaign_id: number | null
          campaign_name: string | null
          date: string | null
          message_count: number | null
          politician_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_with_extra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
        ]
      }
      politician_staff_with_profile: {
        Row: {
          created_at: string | null
          firstname: string | null
          job_title: string | null
          lastname: string | null
          role: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      reply_templates_with_campaign: {
        Row: {
          active: boolean | null
          body: string | null
          campaign_id: number | null
          campaign_name: string | null
          created_at: string | null
          id: number | null
          layout_type: string | null
          name: string | null
          politician_id: number | null
          scheduled_for: string | null
          send_timing: string | null
          subject: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reply_templates_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_with_extra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reply_templates_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reply_templates_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
        ]
      }
      stalwart_mailbox_addresses: {
        Row: {
          email_domain: string | null
          mailbox_address: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_clustering_lock: { Args: { lock_key: number }; Returns: boolean }
      acquire_global_clustering_lock: { Args: never; Returns: boolean }
      cleanup_unconfirmed_campaigns: { Args: never; Returns: number }
      find_cluster_for_message: {
        Args: {
          distance_threshold?: number
          politician_id_filter: number
          query_embedding: string
        }
        Returns: number
      }
      find_politician_by_email: {
        Args: { email_address: string }
        Returns: number
      }
      find_similar_campaigns: {
        Args: {
          distance_threshold?: number
          match_limit?: number
          query_embedding: string
        }
        Returns: {
          distance: number
          id: number
          name: string
          reference_vector: string
          slug: string
          status: string
        }[]
      }
      find_similar_clusters: {
        Args: {
          distance_threshold?: number
          match_limit?: number
          query_embedding: string
        }
        Returns: {
          centroid_vector: string
          distance: number
          id: number
          message_count: number
          status: string
        }[]
      }
      find_similar_messages: {
        Args: {
          distance_threshold?: number
          match_limit?: number
          politician_id_filter: number
          query_embedding: string
        }
        Returns: {
          campaign_id: number
          distance: number
          id: number
        }[]
      }
      find_similar_messages_global: {
        Args: {
          distance_threshold?: number
          match_limit?: number
          query_embedding: string
        }
        Returns: {
          campaign_id: number
          cluster_id: number
          distance: number
          id: number
          politician_id: number
        }[]
      }
      get_message_analytics: {
        Args: { days_back?: number }
        Returns: {
          campaign_id: number
          campaign_name: string
          hour: string
          message_count: number
        }[]
      }
      get_message_status_count:
        | {
            Args: { from_date?: string; to_date?: string }
            Returns: {
              count: number
              status: string
            }[]
          }
        | {
            Args: {
              from_date?: string
              politician_id: string
              to_date?: string
            }
            Returns: {
              count: number
              processing_status: string
            }[]
          }
      hash_email: { Args: { email: string }; Returns: string }
      purge_old_sender_emails: { Args: never; Returns: number }
      release_clustering_lock: { Args: { lock_key: number }; Returns: boolean }
      release_global_clustering_lock: { Args: never; Returns: boolean }
      user_can_access_politician: { Args: { p_id: number }; Returns: boolean }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
