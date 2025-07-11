export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instanciate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          active_minutes: number
          created_at: string
          date: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_minutes?: number
          created_at?: string
          date: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_minutes?: number
          created_at?: string
          date?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_verifications: {
        Row: {
          code: string | null
          created_at: string | null
          email: string | null
          id: string
          is_verified: boolean | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_verified?: boolean | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_verified?: boolean | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          student_id: string
          title: string
          type: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          student_id: string
          title: string
          type?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          student_id?: string
          title?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_uploads: {
        Row: {
          file_url: string | null
          id: string
          reviewed_at: string | null
          status: string | null
          student_id: string
          submission_notes: string | null
          submitted_at: string | null
          task_id: string
        }
        Insert: {
          file_url?: string | null
          id?: string
          reviewed_at?: string | null
          status?: string | null
          student_id: string
          submission_notes?: string | null
          submitted_at?: string | null
          task_id: string
        }
        Update: {
          file_url?: string | null
          id?: string
          reviewed_at?: string | null
          status?: string | null
          student_id?: string
          submission_notes?: string | null
          submitted_at?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_uploads_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_uploads_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_uploads_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      student_otps: {
        Row: {
          created_at: string
          email: string
          id: string
          is_used: boolean
          otp_code: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_used?: boolean
          otp_code: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_used?: boolean
          otp_code?: string
        }
        Relationships: []
      }
      student_portfolios: {
        Row: {
          achievements: string | null
          bio: string | null
          created_at: string
          id: string
          is_public: boolean
          projects: Json | null
          skills: string[] | null
          slug: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          achievements?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          projects?: Json | null
          skills?: string[] | null
          slug?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          achievements?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          projects?: Json | null
          skills?: string[] | null
          slug?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_portfolios_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_portfolios_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_profiles: {
        Row: {
          created_at: string | null
          email: string
          full_name: string
          id: string
          profile_photo_url: string | null
          slug: string | null
          total_xp: number | null
          trust_score: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          profile_photo_url?: string | null
          slug?: string | null
          total_xp?: number | null
          trust_score?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          profile_photo_url?: string | null
          slug?: string | null
          total_xp?: number | null
          trust_score?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      students_auth: {
        Row: {
          created_at: string | null
          email: string | null
          id: string | null
          is_verified: boolean | null
          verification_code: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          is_verified?: boolean | null
          verification_code?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          is_verified?: boolean | null
          verification_code?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string | null
          description: string | null
          due_date: string
          duration_days: number | null
          id: string
          started_at: string | null
          status: string | null
          student_id: string
          title: string
          updated_at: string | null
          upload_deadline: string | null
          xp: number | null
          xp_reward: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date: string
          duration_days?: number | null
          id?: string
          started_at?: string | null
          status?: string | null
          student_id: string
          title: string
          updated_at?: string | null
          upload_deadline?: string | null
          xp?: number | null
          xp_reward?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string
          duration_days?: number | null
          id?: string
          started_at?: string | null
          status?: string | null
          student_id?: string
          title?: string
          updated_at?: string | null
          upload_deadline?: string | null
          xp?: number | null
          xp_reward?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_scores: {
        Row: {
          created_at: string
          id: string
          last_updated: string
          score: number
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_updated?: string
          score?: number
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_updated?: string
          score?: number
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trust_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_logs: {
        Row: {
          created_at: string
          id: string
          source: string | null
          student_id: string
          xp_points: number
        }
        Insert: {
          created_at?: string
          id?: string
          source?: string | null
          student_id: string
          xp_points: number
        }
        Update: {
          created_at?: string
          id?: string
          source?: string | null
          student_id?: string
          xp_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "xp_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      leaderboard: {
        Row: {
          full_name: string | null
          id: string | null
          rank: number | null
          total_xp: number | null
          trust_score: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      generate_unique_slug: {
        Args: { base_name: string }
        Returns: string
      }
      generate_url_slug: {
        Args: { student_name: string }
        Returns: string
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
    Enums: {},
  },
} as const
