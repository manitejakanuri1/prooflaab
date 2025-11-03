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
      admin_notifications: {
        Row: {
          admin_user_id: string
          created_at: string | null
          id: string
          is_read: boolean | null
          link: string | null
          message: string
          metadata: Json | null
          title: string
          type: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message: string
          metadata?: Json | null
          title: string
          type: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string
          metadata?: Json | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          password_hash: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          password_hash?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          password_hash?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_verifications: {
        Row: {
          ai_comments: string | null
          ai_summary: string | null
          created_at: string | null
          id: string
          originality_score: number | null
          proof_id: string
        }
        Insert: {
          ai_comments?: string | null
          ai_summary?: string | null
          created_at?: string | null
          id?: string
          originality_score?: number | null
          proof_id: string
        }
        Update: {
          ai_comments?: string | null
          ai_summary?: string | null
          created_at?: string | null
          id?: string
          originality_score?: number | null
          proof_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_verifications_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          created_at: string
          created_by_admin: string
          description: string | null
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_admin: string
          description?: string | null
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_admin?: string
          description?: string | null
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      auth_rate_limits: {
        Row: {
          attempt_count: number | null
          blocked_until: string | null
          created_at: string
          id: string
          identifier: string
          window_start: string
        }
        Insert: {
          attempt_count?: number | null
          blocked_until?: string | null
          created_at?: string
          id?: string
          identifier: string
          window_start?: string
        }
        Update: {
          attempt_count?: number | null
          blocked_until?: string | null
          created_at?: string
          id?: string
          identifier?: string
          window_start?: string
        }
        Relationships: []
      }
      college_profiles: {
        Row: {
          branches_offered: string[] | null
          college_name: string
          created_at: string
          id: string
          location: string | null
          profile_photo_url: string | null
          student_strength: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          branches_offered?: string[] | null
          college_name: string
          created_at?: string
          id?: string
          location?: string | null
          profile_photo_url?: string | null
          student_strength?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          branches_offered?: string[] | null
          college_name?: string
          created_at?: string
          id?: string
          location?: string | null
          profile_photo_url?: string | null
          student_strength?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      colleges: {
        Row: {
          created_at: string | null
          email: string
          id: string
          invite_code: string | null
          last_active: string | null
          name: string
          status: string | null
          updated_at: string | null
          user_id: string
          verification_status: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          invite_code?: string | null
          last_active?: string | null
          name: string
          status?: string | null
          updated_at?: string | null
          user_id: string
          verification_status?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          invite_code?: string | null
          last_active?: string | null
          name?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
          verification_status?: string | null
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
      github_verifications: {
        Row: {
          authenticity_score: number | null
          commit_count: number | null
          created_at: string | null
          id: string
          last_commit_date: string | null
          proof_id: string
          repo_url: string | null
          unique_contributors: number | null
        }
        Insert: {
          authenticity_score?: number | null
          commit_count?: number | null
          created_at?: string | null
          id?: string
          last_commit_date?: string | null
          proof_id: string
          repo_url?: string | null
          unique_contributors?: number | null
        }
        Update: {
          authenticity_score?: number | null
          commit_count?: number | null
          created_at?: string | null
          id?: string
          last_commit_date?: string | null
          proof_id?: string
          repo_url?: string | null
          unique_contributors?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "github_verifications_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string | null
          created_by: string | null
          expires_at: string
          id: string
          is_used: boolean | null
          role: Database["public"]["Enums"]["app_role"]
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by?: string | null
          expires_at: string
          id?: string
          is_used?: boolean | null
          role: Database["public"]["Enums"]["app_role"]
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string
          id?: string
          is_used?: boolean | null
          role?: Database["public"]["Enums"]["app_role"]
          used_by?: string | null
        }
        Relationships: []
      }
      invite_codes_validation: {
        Row: {
          account_type: Database["public"]["Enums"]["app_role"]
          code: string
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          account_type: Database["public"]["Enums"]["app_role"]
          code: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["app_role"]
          code?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      job_opportunities: {
        Row: {
          apply_link: string
          company_name: string
          created_at: string
          created_by: string | null
          deadline: string
          eligible_branch: string
          id: string
          job_type: string
          location: string
          logo_url: string | null
          role: string
          source: string | null
          status: string | null
        }
        Insert: {
          apply_link: string
          company_name: string
          created_at?: string
          created_by?: string | null
          deadline: string
          eligible_branch?: string
          id?: string
          job_type: string
          location: string
          logo_url?: string | null
          role: string
          source?: string | null
          status?: string | null
        }
        Update: {
          apply_link?: string
          company_name?: string
          created_at?: string
          created_by?: string | null
          deadline?: string
          eligible_branch?: string
          id?: string
          job_type?: string
          location?: string
          logo_url?: string | null
          role?: string
          source?: string | null
          status?: string | null
        }
        Relationships: []
      }
      learning_resources: {
        Row: {
          branch: string
          category: string | null
          created_at: string
          description: string | null
          id: string
          is_premium: boolean
          platform: string
          source: string | null
          status: string | null
          title: string
          url: string
        }
        Insert: {
          branch?: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_premium?: boolean
          platform: string
          source?: string | null
          status?: string | null
          title: string
          url: string
        }
        Update: {
          branch?: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_premium?: boolean
          platform?: string
          source?: string | null
          status?: string | null
          title?: string
          url?: string
        }
        Relationships: []
      }
      manual_adjustment_log: {
        Row: {
          adjustment_type: string
          admin_id: string
          amount: number
          created_at: string
          id: string
          reason: string | null
          student_id: string
        }
        Insert: {
          adjustment_type: string
          admin_id: string
          amount: number
          created_at?: string
          id?: string
          reason?: string | null
          student_id: string
        }
        Update: {
          adjustment_type?: string
          admin_id?: string
          amount?: number
          created_at?: string
          id?: string
          reason?: string | null
          student_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          link: string | null
          message: string
          read_at: string | null
          student_id: string
          title: string
          type: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message: string
          read_at?: string | null
          student_id: string
          title: string
          type?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string
          read_at?: string | null
          student_id?: string
          title?: string
          type?: string | null
        }
        Relationships: [
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
          admin_review_status: string | null
          ai_feedback: string | null
          ai_score: number | null
          ai_status: string | null
          ai_summary: string | null
          file_url: string | null
          id: string
          moss_score: number | null
          moss_status: string | null
          moss_url: string | null
          reflection_answers: Json | null
          reflection_questions: Json | null
          reflection_reasoning: string | null
          reflection_score: number | null
          reflection_status: string | null
          reflection_trigger_time: string | null
          reflection_verified_at: string | null
          review_comment: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          student_id: string
          submission_notes: string | null
          submitted_at: string | null
          task_id: string
        }
        Insert: {
          admin_review_status?: string | null
          ai_feedback?: string | null
          ai_score?: number | null
          ai_status?: string | null
          ai_summary?: string | null
          file_url?: string | null
          id?: string
          moss_score?: number | null
          moss_status?: string | null
          moss_url?: string | null
          reflection_answers?: Json | null
          reflection_questions?: Json | null
          reflection_reasoning?: string | null
          reflection_score?: number | null
          reflection_status?: string | null
          reflection_trigger_time?: string | null
          reflection_verified_at?: string | null
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          student_id: string
          submission_notes?: string | null
          submitted_at?: string | null
          task_id: string
        }
        Update: {
          admin_review_status?: string | null
          ai_feedback?: string | null
          ai_score?: number | null
          ai_status?: string | null
          ai_summary?: string | null
          file_url?: string | null
          id?: string
          moss_score?: number | null
          moss_status?: string | null
          moss_url?: string | null
          reflection_answers?: Json | null
          reflection_questions?: Json | null
          reflection_reasoning?: string | null
          reflection_score?: number | null
          reflection_status?: string | null
          reflection_trigger_time?: string | null
          reflection_verified_at?: string | null
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
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
      recruiter_link_views: {
        Row: {
          id: string
          ip_address: unknown
          link_id: string
          viewed_at: string
        }
        Insert: {
          id?: string
          ip_address?: unknown
          link_id: string
          viewed_at?: string
        }
        Update: {
          id?: string
          ip_address?: unknown
          link_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_link_views_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "recruiter_links"
            referencedColumns: ["id"]
          },
        ]
      }
      recruiter_links: {
        Row: {
          college_id: string
          created_at: string
          created_by: string
          expires_at: string
          filters: Json
          id: string
          status: string
        }
        Insert: {
          college_id: string
          created_at?: string
          created_by: string
          expires_at: string
          filters?: Json
          id?: string
          status?: string
        }
        Update: {
          college_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          filters?: Json
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_links_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_rate_limits: {
        Row: {
          attempt_count: number | null
          blocked_until: string | null
          id: string
          ip_address: unknown
          window_start: string | null
        }
        Insert: {
          attempt_count?: number | null
          blocked_until?: string | null
          id?: string
          ip_address: unknown
          window_start?: string | null
        }
        Update: {
          attempt_count?: number | null
          blocked_until?: string | null
          id?: string
          ip_address?: unknown
          window_start?: string | null
        }
        Relationships: []
      }
      startup_notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          startup_user_id: string
          title: string
          type: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          startup_user_id: string
          title: string
          type?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          startup_user_id?: string
          title?: string
          type?: string | null
        }
        Relationships: []
      }
      startup_profiles: {
        Row: {
          created_at: string
          domain_industry: string | null
          id: string
          startup_name: string
          talent_needs: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          domain_industry?: string | null
          id?: string
          startup_name: string
          talent_needs?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          domain_industry?: string | null
          id?: string
          startup_name?: string
          talent_needs?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      startups: {
        Row: {
          created_at: string | null
          email: string
          id: string
          invite_code: string | null
          name: string
          status: string | null
          updated_at: string | null
          user_id: string
          verification_status: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          invite_code?: string | null
          name: string
          status?: string | null
          updated_at?: string | null
          user_id: string
          verification_status?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          invite_code?: string | null
          name?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
          verification_status?: string | null
        }
        Relationships: []
      }
      student_credits: {
        Row: {
          created_at: string
          credits_available: number
          credits_used_today: number
          id: string
          last_refreshed_at: string
          premium_status: boolean
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits_available?: number
          credits_used_today?: number
          id?: string
          last_refreshed_at?: string
          premium_status?: boolean
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits_available?: number
          credits_used_today?: number
          id?: string
          last_refreshed_at?: string
          premium_status?: boolean
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_credits_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "student_profiles"
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
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_profiles: {
        Row: {
          ai_personalization_enabled: boolean | null
          batch: string | null
          branch: string | null
          career_goals: string | null
          college_id: string | null
          created_at: string | null
          email: string
          full_name: string
          id: string
          key_interests: string[] | null
          last_active: string | null
          preferred_skills: string[] | null
          profile_completed: boolean
          profile_photo_url: string | null
          profile_visibility: string | null
          slug: string | null
          source: string | null
          status: string | null
          temporary_user_id: string | null
          total_xp: number | null
          trust_score: number | null
          updated_at: string | null
          user_id: string | null
          year_of_study: string | null
        }
        Insert: {
          ai_personalization_enabled?: boolean | null
          batch?: string | null
          branch?: string | null
          career_goals?: string | null
          college_id?: string | null
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          key_interests?: string[] | null
          last_active?: string | null
          preferred_skills?: string[] | null
          profile_completed?: boolean
          profile_photo_url?: string | null
          profile_visibility?: string | null
          slug?: string | null
          source?: string | null
          status?: string | null
          temporary_user_id?: string | null
          total_xp?: number | null
          trust_score?: number | null
          updated_at?: string | null
          user_id?: string | null
          year_of_study?: string | null
        }
        Update: {
          ai_personalization_enabled?: boolean | null
          batch?: string | null
          branch?: string | null
          career_goals?: string | null
          college_id?: string | null
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          key_interests?: string[] | null
          last_active?: string | null
          preferred_skills?: string[] | null
          profile_completed?: boolean
          profile_photo_url?: string | null
          profile_visibility?: string | null
          slug?: string | null
          source?: string | null
          status?: string | null
          temporary_user_id?: string | null
          total_xp?: number | null
          trust_score?: number | null
          updated_at?: string | null
          user_id?: string | null
          year_of_study?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_profiles_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          college_id: string | null
          created_at: string | null
          email: string
          id: string
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          college_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          college_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      students_auth: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          is_verified: boolean | null
          verification_code: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          is_verified?: boolean | null
          verification_code?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          is_verified?: boolean | null
          verification_code?: string | null
        }
        Relationships: []
      }
      task_applications: {
        Row: {
          application_note: string | null
          created_at: string
          id: string
          portfolio_link: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          student_id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          application_note?: string | null
          created_at?: string
          id?: string
          portfolio_link?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id: string
          task_id: string
          updated_at?: string
        }
        Update: {
          application_note?: string | null
          created_at?: string
          id?: string
          portfolio_link?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_applications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_applications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignments: {
        Row: {
          assigned_at: string | null
          completed_at: string | null
          feedback: string | null
          id: string
          review_status: string | null
          reviewed_by: string | null
          status: string | null
          student_id: string | null
          submitted_at: string | null
          task_id: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_at?: string | null
          completed_at?: string | null
          feedback?: string | null
          id?: string
          review_status?: string | null
          reviewed_by?: string | null
          status?: string | null
          student_id?: string | null
          submitted_at?: string | null
          task_id?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_at?: string | null
          completed_at?: string | null
          feedback?: string | null
          id?: string
          review_status?: string | null
          reviewed_by?: string | null
          status?: string | null
          student_id?: string | null
          submitted_at?: string | null
          task_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_task_assignments_task"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          branch: string | null
          category: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          difficulty: string | null
          id: string
          skills: string[] | null
          source: string | null
          title: string
          updated_at: string | null
          visibility: string | null
          xp_reward: number | null
        }
        Insert: {
          branch?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty?: string | null
          id?: string
          skills?: string[] | null
          source?: string | null
          title: string
          updated_at?: string | null
          visibility?: string | null
          xp_reward?: number | null
        }
        Update: {
          branch?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty?: string | null
          id?: string
          skills?: string[] | null
          source?: string | null
          title?: string
          updated_at?: string | null
          visibility?: string | null
          xp_reward?: number | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          ai_metadata: Json | null
          approved_by_admin: boolean | null
          category: string | null
          completed_at: string | null
          created_at: string | null
          created_by_admin_id: string | null
          created_by_college_id: string | null
          created_by_startup_id: string | null
          created_by_type: string | null
          description: string | null
          due_date: string
          duration_days: number | null
          id: string
          is_ai_generated: boolean | null
          is_paid: boolean | null
          posted_at: string | null
          required_skills: string[] | null
          source: string | null
          started_at: string | null
          status: string | null
          student_id: string | null
          suggested_xp: number | null
          title: string
          updated_at: string | null
          upload_deadline: string | null
          visibility: string | null
          xp: number | null
          xp_reward: number | null
        }
        Insert: {
          ai_metadata?: Json | null
          approved_by_admin?: boolean | null
          category?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by_admin_id?: string | null
          created_by_college_id?: string | null
          created_by_startup_id?: string | null
          created_by_type?: string | null
          description?: string | null
          due_date: string
          duration_days?: number | null
          id?: string
          is_ai_generated?: boolean | null
          is_paid?: boolean | null
          posted_at?: string | null
          required_skills?: string[] | null
          source?: string | null
          started_at?: string | null
          status?: string | null
          student_id?: string | null
          suggested_xp?: number | null
          title: string
          updated_at?: string | null
          upload_deadline?: string | null
          visibility?: string | null
          xp?: number | null
          xp_reward?: number | null
        }
        Update: {
          ai_metadata?: Json | null
          approved_by_admin?: boolean | null
          category?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by_admin_id?: string | null
          created_by_college_id?: string | null
          created_by_startup_id?: string | null
          created_by_type?: string | null
          description?: string | null
          due_date?: string
          duration_days?: number | null
          id?: string
          is_ai_generated?: boolean | null
          is_paid?: boolean | null
          posted_at?: string | null
          required_skills?: string[] | null
          source?: string | null
          started_at?: string | null
          status?: string | null
          student_id?: string | null
          suggested_xp?: number | null
          title?: string
          updated_at?: string | null
          upload_deadline?: string | null
          visibility?: string | null
          xp?: number | null
          xp_reward?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_tasks_created_by_college"
            columns: ["created_by_college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
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
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          compact_mode: boolean | null
          created_at: string
          email_notifications: boolean | null
          id: string
          portfolio_public: boolean | null
          push_notifications: boolean | null
          show_progress_to_others: boolean | null
          show_xp_rank: boolean | null
          task_reminders: boolean | null
          theme: string | null
          updated_at: string
          user_id: string
          weekly_digest: boolean | null
        }
        Insert: {
          compact_mode?: boolean | null
          created_at?: string
          email_notifications?: boolean | null
          id?: string
          portfolio_public?: boolean | null
          push_notifications?: boolean | null
          show_progress_to_others?: boolean | null
          show_xp_rank?: boolean | null
          task_reminders?: boolean | null
          theme?: string | null
          updated_at?: string
          user_id: string
          weekly_digest?: boolean | null
        }
        Update: {
          compact_mode?: boolean | null
          created_at?: string
          email_notifications?: boolean | null
          id?: string
          portfolio_public?: boolean | null
          push_notifications?: boolean | null
          show_progress_to_others?: boolean | null
          show_xp_rank?: boolean | null
          task_reminders?: boolean | null
          theme?: string | null
          updated_at?: string
          user_id?: string
          weekly_digest?: boolean | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          has_completed_wizard: boolean
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          has_completed_wizard?: boolean
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          has_completed_wizard?: boolean
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
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
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_rate_limit: {
        Args: {
          _identifier: string
          _max_attempts?: number
          _window_minutes?: number
        }
        Returns: boolean
      }
      cleanup_expired_otps: { Args: never; Returns: undefined }
      create_user_with_role: {
        Args: {
          _invite_code?: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      generate_unique_slug: { Args: { input_text: string }; Returns: string }
      generate_url_slug: { Args: { student_name: string }; Returns: string }
      get_current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          full_name: string
          id: string
          rank: number
          total_xp: number
          trust_score: number
        }[]
      }
      get_leaderboard_data: {
        Args: never
        Returns: {
          full_name: string
          id: string
          rank: number
          total_xp: number
          trust_score: number
        }[]
      }
      get_user_role: {
        Args: { _user_id?: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_email_confirmed: { Args: { user_id: string }; Returns: boolean }
      notify_all_admins: {
        Args: {
          notification_link?: string
          notification_message: string
          notification_metadata?: Json
          notification_title: string
          notification_type: string
        }
        Returns: undefined
      }
      reset_daily_credits: { Args: never; Returns: undefined }
      use_invite_code: {
        Args: { _code: string; _user_id: string }
        Returns: boolean
      }
      validate_and_use_invite_code: {
        Args: {
          _account_type: Database["public"]["Enums"]["app_role"]
          _code: string
          _user_id: string
        }
        Returns: boolean
      }
      validate_email: { Args: { _email: string }; Returns: boolean }
      validate_invite_code: {
        Args: { _code: string; _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      validate_invite_code_secure: {
        Args: { _code: string; _role: Database["public"]["Enums"]["app_role"] }
        Returns: Json
      }
      validate_task_title: { Args: { _title: string }; Returns: boolean }
      verify_invite_code_and_activate: {
        Args: {
          _code: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "college_admin" | "startup" | "student"
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
      app_role: ["admin", "college_admin", "startup", "student"],
    },
  },
} as const
