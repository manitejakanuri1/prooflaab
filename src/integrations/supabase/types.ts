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
    PostgrestVersion: "14.5"
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
          date?: string
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
      ai_templates: {
        Row: {
          created_at: string
          hit_count: number
          kind: string
          last_used_at: string
          level_profile: string | null
          paths: string[] | null
          payload: Json
          role: string | null
          template_key: string
        }
        Insert: {
          created_at?: string
          hit_count?: number
          kind: string
          last_used_at?: string
          level_profile?: string | null
          paths?: string[] | null
          payload: Json
          role?: string | null
          template_key: string
        }
        Update: {
          created_at?: string
          hit_count?: number
          kind?: string
          last_used_at?: string
          level_profile?: string | null
          paths?: string[] | null
          payload?: Json
          role?: string | null
          template_key?: string
        }
        Relationships: []
      }
      ai_verifications: {
        Row: {
          ai_authorship_risk: number | null
          ai_comments: string | null
          ai_summary: string | null
          created_at: string
          explanation: string | null
          id: string
          originality_score: number | null
          proof_id: string
          raw_model_output: Json | null
        }
        Insert: {
          ai_authorship_risk?: number | null
          ai_comments?: string | null
          ai_summary?: string | null
          created_at?: string
          explanation?: string | null
          id?: string
          originality_score?: number | null
          proof_id: string
          raw_model_output?: Json | null
        }
        Update: {
          ai_authorship_risk?: number | null
          ai_comments?: string | null
          ai_summary?: string | null
          created_at?: string
          explanation?: string | null
          id?: string
          originality_score?: number | null
          proof_id?: string
          raw_model_output?: Json | null
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
          expiry_date: string | null
          id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_admin: string
          description?: string | null
          expiry_date?: string | null
          id?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_admin?: string
          description?: string | null
          expiry_date?: string | null
          id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          college_id: string | null
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
          college_id?: string | null
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
          college_id?: string | null
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      badges: {
        Row: {
          created_at: string
          description: string
          emoji: string
          name: string
          rule_kind: string
          rule_value: number | null
          slug: string
          track_slug: string | null
        }
        Insert: {
          created_at?: string
          description: string
          emoji?: string
          name: string
          rule_kind: string
          rule_value?: number | null
          slug: string
          track_slug?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          emoji?: string
          name?: string
          rule_kind?: string
          rule_value?: number | null
          slug?: string
          track_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "badges_track_slug_fkey"
            columns: ["track_slug"]
            isOneToOne: false
            referencedRelation: "level_tracks"
            referencedColumns: ["slug"]
          },
        ]
      }
      coding_streaks: {
        Row: {
          created_at: string
          current_streak: number
          id: string
          last_active_date: string | null
          last_synced_at: string | null
          longest_streak: number
          platform: string
          student_id: string
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          current_streak?: number
          id?: string
          last_active_date?: string | null
          last_synced_at?: string | null
          longest_streak?: number
          platform: string
          student_id: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          current_streak?: number
          id?: string
          last_active_date?: string | null
          last_synced_at?: string | null
          longest_streak?: number
          platform?: string
          student_id?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coding_streaks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      college_profiles: {
        Row: {
          branches_offered: string[]
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
          branches_offered?: string[]
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
          branches_offered?: string[]
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
          created_at: string
          email: string
          id: string
          invite_code: string | null
          last_active: string | null
          name: string
          status: string
          updated_at: string
          user_id: string
          verification_status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invite_code?: string | null
          last_active?: string | null
          name: string
          status?: string
          updated_at?: string
          user_id: string
          verification_status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invite_code?: string | null
          last_active?: string | null
          name?: string
          status?: string
          updated_at?: string
          user_id?: string
          verification_status?: string
        }
        Relationships: []
      }
      conceptual_answer_keys: {
        Row: {
          answers: Json
          created_at: string
          test_id: string
        }
        Insert: {
          answers: Json
          created_at?: string
          test_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conceptual_answer_keys_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: true
            referencedRelation: "conceptual_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      conceptual_tests: {
        Row: {
          answer_scores: Json
          created_at: string
          id: string
          proof_id: string
          questions: Json
          status: string
          student_answers: Json
        }
        Insert: {
          answer_scores?: Json
          created_at?: string
          id?: string
          proof_id: string
          questions?: Json
          status?: string
          student_answers?: Json
        }
        Update: {
          answer_scores?: Json
          created_at?: string
          id?: string
          proof_id?: string
          questions?: Json
          status?: string
          student_answers?: Json
        }
        Relationships: [
          {
            foreignKeyName: "conceptual_tests_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: true
            referencedRelation: "proof_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      cosigns: {
        Row: {
          cosigner_id: string
          cosigner_name: string
          cosigner_role: string
          created_at: string
          id: string
          note: string | null
          proof_id: string
          student_id: string
        }
        Insert: {
          cosigner_id: string
          cosigner_name: string
          cosigner_role: string
          created_at?: string
          id?: string
          note?: string | null
          proof_id: string
          student_id: string
        }
        Update: {
          cosigner_id?: string
          cosigner_name?: string
          cosigner_role?: string
          created_at?: string
          id?: string
          note?: string | null
          proof_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cosigns_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cosigns_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      github_verifications: {
        Row: {
          authenticity_notes: Json | null
          authenticity_score: number | null
          commit_count: number | null
          created_at: string
          first_commit_at: string | null
          id: string
          largest_commit_delta: number | null
          last_commit_at: string | null
          proof_id: string
          repo_url: string | null
          unique_contributors: number | null
        }
        Insert: {
          authenticity_notes?: Json | null
          authenticity_score?: number | null
          commit_count?: number | null
          created_at?: string
          first_commit_at?: string | null
          id?: string
          largest_commit_delta?: number | null
          last_commit_at?: string | null
          proof_id: string
          repo_url?: string | null
          unique_contributors?: number | null
        }
        Update: {
          authenticity_notes?: Json | null
          authenticity_score?: number | null
          commit_count?: number | null
          created_at?: string
          first_commit_at?: string | null
          id?: string
          largest_commit_delta?: number | null
          last_commit_at?: string | null
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
      interventions: {
        Row: {
          college_id: string
          created_at: string
          created_by: string
          id: string
          message: string | null
          reason: string
          resolved_at: string | null
          status: string
          student_id: string
          type: string
        }
        Insert: {
          college_id: string
          created_at?: string
          created_by: string
          id?: string
          message?: string | null
          reason: string
          resolved_at?: string | null
          status?: string
          student_id: string
          type: string
        }
        Update: {
          college_id?: string
          created_at?: string
          created_by?: string
          id?: string
          message?: string | null
          reason?: string
          resolved_at?: string | null
          status?: string
          student_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "interventions_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_opportunities: {
        Row: {
          apply_link: string
          company_name: string
          created_at: string
          created_by: string | null
          deadline: string | null
          description: string | null
          eligible_branch: string
          id: string
          job_type: string
          location: string
          logo_url: string | null
          role: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          apply_link: string
          company_name: string
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          eligible_branch?: string
          id?: string
          job_type?: string
          location?: string
          logo_url?: string | null
          role: string
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          apply_link?: string
          company_name?: string
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          eligible_branch?: string
          id?: string
          job_type?: string
          location?: string
          logo_url?: string | null
          role?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      learning_resources: {
        Row: {
          branch: string
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_premium: boolean
          platform: string
          status: string
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          branch?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_premium?: boolean
          platform?: string
          status?: string
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          branch?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_premium?: boolean
          platform?: string
          status?: string
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      level_content: {
        Row: {
          code_example: Json | null
          explanation: string
          generated_at: string
          level_id: string
          proof_brief: string | null
          proof_title: string | null
          quiz: Json
          resources: Json | null
          sandbox: Json | null
        }
        Insert: {
          code_example?: Json | null
          explanation: string
          generated_at?: string
          level_id: string
          proof_brief?: string | null
          proof_title?: string | null
          quiz?: Json
          resources?: Json | null
          sandbox?: Json | null
        }
        Update: {
          code_example?: Json | null
          explanation?: string
          generated_at?: string
          level_id?: string
          proof_brief?: string | null
          proof_title?: string | null
          quiz?: Json
          resources?: Json | null
          sandbox?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "level_content_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: true
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      level_tracks: {
        Row: {
          emoji: string
          interest: string
          name: string
          role: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          emoji?: string
          interest: string
          name: string
          role?: string | null
          slug: string
          sort_order?: number
        }
        Update: {
          emoji?: string
          interest?: string
          name?: string
          role?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      levels: {
        Row: {
          id: string
          kind: string
          level_number: number
          skill: string
          sub_level: number
          title: string
          track_slug: string
        }
        Insert: {
          id?: string
          kind?: string
          level_number: number
          skill: string
          sub_level?: number
          title: string
          track_slug: string
        }
        Update: {
          id?: string
          kind?: string
          level_number?: number
          skill?: string
          sub_level?: number
          title?: string
          track_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "levels_track_slug_fkey"
            columns: ["track_slug"]
            isOneToOne: false
            referencedRelation: "level_tracks"
            referencedColumns: ["slug"]
          },
        ]
      }
      llm_cache: {
        Row: {
          created_at: string
          feature: string
          hit_count: number
          last_hit_at: string | null
          model: string | null
          prompt_hash: string
          response: string
          saved_tokens: number
        }
        Insert: {
          created_at?: string
          feature: string
          hit_count?: number
          last_hit_at?: string | null
          model?: string | null
          prompt_hash: string
          response: string
          saved_tokens?: number
        }
        Update: {
          created_at?: string
          feature?: string
          hit_count?: number
          last_hit_at?: string | null
          model?: string | null
          prompt_hash?: string
          response?: string
          saved_tokens?: number
        }
        Relationships: []
      }
      llm_usage: {
        Row: {
          completion_tokens: number
          created_at: string
          feature: string
          id: string
          model: string | null
          prompt_tokens: number
          provider: string
          student_id: string | null
          total_tokens: number
          truncated: boolean
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number
          created_at?: string
          feature: string
          id?: string
          model?: string | null
          prompt_tokens?: number
          provider: string
          student_id?: string | null
          total_tokens?: number
          truncated?: boolean
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          feature?: string
          id?: string
          model?: string | null
          prompt_tokens?: number
          provider?: string
          student_id?: string | null
          total_tokens?: number
          truncated?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_usage_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lot_templates: {
        Row: {
          code_sample: string | null
          created_at: string
          difficulty: string
          estimate_minutes: number
          generating_by: string | null
          generating_since: string | null
          level_id: string
          lot_category: string
          origin: string
          scenario: string
          source_jd: string | null
          title: string
          updated_at: string
        }
        Insert: {
          code_sample?: string | null
          created_at?: string
          difficulty?: string
          estimate_minutes?: number
          generating_by?: string | null
          generating_since?: string | null
          level_id: string
          lot_category?: string
          origin?: string
          scenario: string
          source_jd?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          code_sample?: string | null
          created_at?: string
          difficulty?: string
          estimate_minutes?: number
          generating_by?: string | null
          generating_since?: string | null
          level_id?: string
          lot_category?: string
          origin?: string
          scenario?: string
          source_jd?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lot_templates_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: true
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_adjustment_log: {
        Row: {
          adjustment_type: string
          admin_id: string
          amount: number
          created_at: string
          id: string
          reason: string
          student_id: string
        }
        Insert: {
          adjustment_type: string
          admin_id: string
          amount: number
          created_at?: string
          id?: string
          reason: string
          student_id: string
        }
        Update: {
          adjustment_type?: string
          admin_id?: string
          amount?: number
          created_at?: string
          id?: string
          reason?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_adjustment_log_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          audience: string
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string
          metadata: Json | null
          read_at: string | null
          source: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          audience?: string
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          metadata?: Json | null
          read_at?: string | null
          source?: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          audience?: string
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          metadata?: Json | null
          read_at?: string | null
          source?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      proof_appeals: {
        Row: {
          appeal_reason: string
          appeal_status: string
          created_at: string
          id: string
          proof_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_comment: string | null
          reviewer_decision: string | null
          student_id: string
        }
        Insert: {
          appeal_reason: string
          appeal_status?: string
          created_at?: string
          id?: string
          proof_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_comment?: string | null
          reviewer_decision?: string | null
          student_id: string
        }
        Update: {
          appeal_reason?: string
          appeal_status?: string
          created_at?: string
          id?: string
          proof_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_comment?: string | null
          reviewer_decision?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_appeals_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_appeals_student_id_fkey"
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
          declaration_acknowledged: boolean
          declaration_text: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          file_url: string | null
          id: string
          is_public: boolean
          moss_score: number | null
          moss_status: string | null
          moss_url: string | null
          reflection_answers: Json | null
          reflection_questions: Json | null
          reflection_reasoning: string | null
          reflection_requested: boolean
          reflection_score: number | null
          reflection_status: string | null
          reflection_trigger_time: string | null
          reflection_verified_at: string | null
          review_comment: string | null
          review_flag: boolean
          review_override_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          reviewer_id: string | null
          status: string
          student_id: string
          submission_notes: string | null
          submitted_at: string
          task_id: string
        }
        Insert: {
          admin_review_status?: string | null
          ai_feedback?: string | null
          ai_score?: number | null
          ai_status?: string | null
          ai_summary?: string | null
          declaration_acknowledged?: boolean
          declaration_text?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_public?: boolean
          moss_score?: number | null
          moss_status?: string | null
          moss_url?: string | null
          reflection_answers?: Json | null
          reflection_questions?: Json | null
          reflection_reasoning?: string | null
          reflection_requested?: boolean
          reflection_score?: number | null
          reflection_status?: string | null
          reflection_trigger_time?: string | null
          reflection_verified_at?: string | null
          review_comment?: string | null
          review_flag?: boolean
          review_override_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          reviewer_id?: string | null
          status?: string
          student_id: string
          submission_notes?: string | null
          submitted_at?: string
          task_id: string
        }
        Update: {
          admin_review_status?: string | null
          ai_feedback?: string | null
          ai_score?: number | null
          ai_status?: string | null
          ai_summary?: string | null
          declaration_acknowledged?: boolean
          declaration_text?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_public?: boolean
          moss_score?: number | null
          moss_status?: string | null
          moss_url?: string | null
          reflection_answers?: Json | null
          reflection_questions?: Json | null
          reflection_reasoning?: string | null
          reflection_requested?: boolean
          reflection_score?: number | null
          reflection_status?: string | null
          reflection_trigger_time?: string | null
          reflection_verified_at?: string | null
          review_comment?: string | null
          review_flag?: boolean
          review_override_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          reviewer_id?: string | null
          status?: string
          student_id?: string
          submission_notes?: string | null
          submitted_at?: string
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
      quests: {
        Row: {
          cadence: string
          created_at: string
          description: string
          is_active: boolean
          metric: string
          name: string
          slug: string
          target: number
          xp_reward: number
        }
        Insert: {
          cadence: string
          created_at?: string
          description: string
          is_active?: boolean
          metric: string
          name: string
          slug: string
          target?: number
          xp_reward?: number
        }
        Update: {
          cadence?: string
          created_at?: string
          description?: string
          is_active?: boolean
          metric?: string
          name?: string
          slug?: string
          target?: number
          xp_reward?: number
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          hits: number
          subject: string
          window_start: string
        }
        Insert: {
          bucket: string
          hits?: number
          subject: string
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
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
      recruiter_shortlists: {
        Row: {
          created_at: string
          id: string
          note: string | null
          recruiter_id: string
          responded_at: string | null
          stage: string
          student_id: string
          student_response: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          recruiter_id: string
          responded_at?: string | null
          stage?: string
          student_id: string
          student_response?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          recruiter_id?: string
          responded_at?: string | null
          stage?: string
          student_id?: string
          student_response?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_shortlists_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "recruiters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruiter_shortlists_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recruiter_views: {
        Row: {
          id: string
          recruiter_id: string
          student_id: string
          viewed_at: string
        }
        Insert: {
          id?: string
          recruiter_id: string
          student_id: string
          viewed_at?: string
        }
        Update: {
          id?: string
          recruiter_id?: string
          student_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_views_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "recruiters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruiter_views_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recruiters: {
        Row: {
          about: string | null
          company: string
          contact_name: string
          created_at: string
          id: string
          updated_at: string
          verified: boolean
          verified_at: string | null
          verified_by: string | null
          website: string | null
          work_email: string | null
        }
        Insert: {
          about?: string | null
          company: string
          contact_name: string
          created_at?: string
          id: string
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
          work_email?: string | null
        }
        Update: {
          about?: string | null
          company?: string
          contact_name?: string
          created_at?: string
          id?: string
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
          work_email?: string | null
        }
        Relationships: []
      }
      resume_assessments: {
        Row: {
          answer_scores: Json | null
          coding_questions: Json
          coding_results: Json | null
          created_at: string
          elapsed_seconds: number | null
          id: string
          is_retest: boolean
          questions: Json
          resume_claims_id: string | null
          retest_notified_at: string | null
          started_at: string | null
          status: string
          student_answers: Json
          student_id: string
          student_interest_id: string | null
          updated_at: string
        }
        Insert: {
          answer_scores?: Json | null
          coding_questions?: Json
          coding_results?: Json | null
          created_at?: string
          elapsed_seconds?: number | null
          id?: string
          is_retest?: boolean
          questions?: Json
          resume_claims_id?: string | null
          retest_notified_at?: string | null
          started_at?: string | null
          status?: string
          student_answers?: Json
          student_id: string
          student_interest_id?: string | null
          updated_at?: string
        }
        Update: {
          answer_scores?: Json | null
          coding_questions?: Json
          coding_results?: Json | null
          created_at?: string
          elapsed_seconds?: number | null
          id?: string
          is_retest?: boolean
          questions?: Json
          resume_claims_id?: string | null
          retest_notified_at?: string | null
          started_at?: string | null
          status?: string
          student_answers?: Json
          student_id?: string
          student_interest_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_assessments_resume_claims_id_fkey"
            columns: ["resume_claims_id"]
            isOneToOne: true
            referencedRelation: "resume_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_assessments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_assessments_student_interest_id_fkey"
            columns: ["student_interest_id"]
            isOneToOne: true
            referencedRelation: "student_interests"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_claims: {
        Row: {
          ai_improved_resume: string | null
          ats_match_notes: string | null
          ats_match_score: number | null
          certifications: string[]
          confirmed_at: string | null
          created_at: string
          feedback_acknowledged: boolean
          id: string
          projects: Json
          raw_extraction: Json | null
          resume_quality_notes: string | null
          resume_quality_score: number | null
          skill_relevance_notes: string | null
          skills: string[]
          status: string
          storage_path: string
          student_id: string
          target_role: string | null
          updated_at: string
        }
        Insert: {
          ai_improved_resume?: string | null
          ats_match_notes?: string | null
          ats_match_score?: number | null
          certifications?: string[]
          confirmed_at?: string | null
          created_at?: string
          feedback_acknowledged?: boolean
          id?: string
          projects?: Json
          raw_extraction?: Json | null
          resume_quality_notes?: string | null
          resume_quality_score?: number | null
          skill_relevance_notes?: string | null
          skills?: string[]
          status?: string
          storage_path: string
          student_id: string
          target_role?: string | null
          updated_at?: string
        }
        Update: {
          ai_improved_resume?: string | null
          ats_match_notes?: string | null
          ats_match_score?: number | null
          certifications?: string[]
          confirmed_at?: string | null
          created_at?: string
          feedback_acknowledged?: boolean
          id?: string
          projects?: Json
          raw_extraction?: Json | null
          resume_quality_notes?: string | null
          resume_quality_score?: number | null
          skill_relevance_notes?: string | null
          skills?: string[]
          status?: string
          storage_path?: string
          student_id?: string
          target_role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_claims_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_scorecards: {
        Row: {
          assessment_id: string
          ats_match_score: number | null
          coding_score: number | null
          created_at: string
          id: string
          interview_readiness_score: number | null
          is_retest: boolean
          project_proof_score: number | null
          reasoning_score: number | null
          resume_claims_id: string | null
          resume_quality_score: number | null
          roadmap: string | null
          skill_gap: Json | null
          skill_proof_score: number | null
          student_id: string
          student_interest_id: string | null
          voice_authenticity_score: number | null
          voice_notes: string | null
        }
        Insert: {
          assessment_id: string
          ats_match_score?: number | null
          coding_score?: number | null
          created_at?: string
          id?: string
          interview_readiness_score?: number | null
          is_retest?: boolean
          project_proof_score?: number | null
          reasoning_score?: number | null
          resume_claims_id?: string | null
          resume_quality_score?: number | null
          roadmap?: string | null
          skill_gap?: Json | null
          skill_proof_score?: number | null
          student_id: string
          student_interest_id?: string | null
          voice_authenticity_score?: number | null
          voice_notes?: string | null
        }
        Update: {
          assessment_id?: string
          ats_match_score?: number | null
          coding_score?: number | null
          created_at?: string
          id?: string
          interview_readiness_score?: number | null
          is_retest?: boolean
          project_proof_score?: number | null
          reasoning_score?: number | null
          resume_claims_id?: string | null
          resume_quality_score?: number | null
          roadmap?: string | null
          skill_gap?: Json | null
          skill_proof_score?: number | null
          student_id?: string
          student_interest_id?: string | null
          voice_authenticity_score?: number | null
          voice_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resume_scorecards_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: true
            referencedRelation: "resume_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_scorecards_resume_claims_id_fkey"
            columns: ["resume_claims_id"]
            isOneToOne: false
            referencedRelation: "resume_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_scorecards_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_scorecards_student_interest_id_fkey"
            columns: ["student_interest_id"]
            isOneToOne: false
            referencedRelation: "student_interests"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          champion_squad_id: string | null
          college_id: string | null
          completed_at: string | null
          created_at: string
          ends_on: string
          id: string
          is_current: boolean
          name: string
          planned_weeks: number
          runner_up_squad_id: string | null
          starts_on: string
          status: string
          third_squad_id: string | null
        }
        Insert: {
          champion_squad_id?: string | null
          college_id?: string | null
          completed_at?: string | null
          created_at?: string
          ends_on: string
          id?: string
          is_current?: boolean
          name: string
          planned_weeks?: number
          runner_up_squad_id?: string | null
          starts_on: string
          status?: string
          third_squad_id?: string | null
        }
        Update: {
          champion_squad_id?: string | null
          college_id?: string | null
          completed_at?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          is_current?: boolean
          name?: string
          planned_weeks?: number
          runner_up_squad_id?: string | null
          starts_on?: string
          status?: string
          third_squad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seasons_champion_squad_id_fkey"
            columns: ["champion_squad_id"]
            isOneToOne: false
            referencedRelation: "squads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seasons_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seasons_runner_up_squad_id_fkey"
            columns: ["runner_up_squad_id"]
            isOneToOne: false
            referencedRelation: "squads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seasons_third_squad_id_fkey"
            columns: ["third_squad_id"]
            isOneToOne: false
            referencedRelation: "squads"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          created_at: string
          detail: Json
          email: string | null
          event_type: string
          id: string
          ip: string | null
          severity: string
          source: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          email?: string | null
          event_type: string
          id?: string
          ip?: string | null
          severity?: string
          source?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          email?: string | null
          event_type?: string
          id?: string
          ip?: string | null
          severity?: string
          source?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      squad_matches: {
        Row: {
          away_points: number | null
          away_squad: string
          created_at: string
          home_points: number | null
          home_squad: string
          id: string
          round_number: number | null
          scheduled_at: string
          season_id: string | null
          status: string
        }
        Insert: {
          away_points?: number | null
          away_squad: string
          created_at?: string
          home_points?: number | null
          home_squad: string
          id?: string
          round_number?: number | null
          scheduled_at: string
          season_id?: string | null
          status?: string
        }
        Update: {
          away_points?: number | null
          away_squad?: string
          created_at?: string
          home_points?: number | null
          home_squad?: string
          id?: string
          round_number?: number | null
          scheduled_at?: string
          season_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "squad_matches_away_squad_fkey"
            columns: ["away_squad"]
            isOneToOne: false
            referencedRelation: "squads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "squad_matches_home_squad_fkey"
            columns: ["home_squad"]
            isOneToOne: false
            referencedRelation: "squads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "squad_matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_members: {
        Row: {
          assigned_by: string | null
          contribution: number
          id: string
          joined_at: string
          left_at: string | null
          meet_url: string | null
          membership_type: string
          role: string | null
          squad_id: string
          student_id: string
        }
        Insert: {
          assigned_by?: string | null
          contribution?: number
          id?: string
          joined_at?: string
          left_at?: string | null
          meet_url?: string | null
          membership_type?: string
          role?: string | null
          squad_id: string
          student_id: string
        }
        Update: {
          assigned_by?: string | null
          contribution?: number
          id?: string
          joined_at?: string
          left_at?: string | null
          meet_url?: string | null
          membership_type?: string
          role?: string | null
          squad_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "squad_members_squad_id_fkey"
            columns: ["squad_id"]
            isOneToOne: false
            referencedRelation: "squads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "squad_members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_name_themes: {
        Row: {
          branch: string
          theme: string
        }
        Insert: {
          branch: string
          theme: string
        }
        Update: {
          branch?: string
          theme?: string
        }
        Relationships: []
      }
      squad_scoring_rules: {
        Row: {
          description: string | null
          label: string
          metric: string
          points: number
        }
        Insert: {
          description?: string | null
          label: string
          metric: string
          points: number
        }
        Update: {
          description?: string | null
          label?: string
          metric?: string
          points?: number
        }
        Relationships: []
      }
      squad_weekly_scores: {
        Row: {
          active_members: number
          breakdown: Json
          computed_at: string
          id: string
          points: number
          rank: number | null
          season_id: string
          squad_id: string
          total_members: number
          week: number
        }
        Insert: {
          active_members?: number
          breakdown?: Json
          computed_at?: string
          id?: string
          points?: number
          rank?: number | null
          season_id: string
          squad_id: string
          total_members?: number
          week: number
        }
        Update: {
          active_members?: number
          breakdown?: Json
          computed_at?: string
          id?: string
          points?: number
          rank?: number | null
          season_id?: string
          squad_id?: string
          total_members?: number
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "squad_weekly_scores_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "squad_weekly_scores_squad_id_fkey"
            columns: ["squad_id"]
            isOneToOne: false
            referencedRelation: "squads"
            referencedColumns: ["id"]
          },
        ]
      }
      squads: {
        Row: {
          archived_at: string | null
          college_id: string | null
          created_at: string
          draws: number
          id: string
          is_locked: boolean
          losses: number
          max_members: number
          name: string
          points: number
          previous_rank: number | null
          rank: number | null
          season_id: string | null
          updated_at: string
          wins: number
        }
        Insert: {
          archived_at?: string | null
          college_id?: string | null
          created_at?: string
          draws?: number
          id?: string
          is_locked?: boolean
          losses?: number
          max_members?: number
          name: string
          points?: number
          previous_rank?: number | null
          rank?: number | null
          season_id?: string | null
          updated_at?: string
          wins?: number
        }
        Update: {
          archived_at?: string | null
          college_id?: string | null
          created_at?: string
          draws?: number
          id?: string
          is_locked?: boolean
          losses?: number
          max_members?: number
          name?: string
          points?: number
          previous_rank?: number | null
          rank?: number | null
          season_id?: string | null
          updated_at?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "squads_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "squads_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      startup_profiles: {
        Row: {
          created_at: string
          domain_industry: string | null
          id: string
          startup_name: string
          talent_needs: string[]
          team_size: number | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          created_at?: string
          domain_industry?: string | null
          id?: string
          startup_name: string
          talent_needs?: string[]
          team_size?: number | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          created_at?: string
          domain_industry?: string | null
          id?: string
          startup_name?: string
          talent_needs?: string[]
          team_size?: number | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      startups: {
        Row: {
          created_at: string
          email: string
          id: string
          invite_code: string | null
          name: string
          status: string
          updated_at: string
          user_id: string
          verification_status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invite_code?: string | null
          name: string
          status?: string
          updated_at?: string
          user_id: string
          verification_status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invite_code?: string | null
          name?: string
          status?: string
          updated_at?: string
          user_id?: string
          verification_status?: string
        }
        Relationships: []
      }
      student_activity_events: {
        Row: {
          college_id: string | null
          event_type: string
          id: number
          metadata: Json
          occurred_at: string
          source_id: string | null
          source_type: string | null
          student_id: string
        }
        Insert: {
          college_id?: string | null
          event_type: string
          id?: never
          metadata?: Json
          occurred_at?: string
          source_id?: string | null
          source_type?: string | null
          student_id: string
        }
        Update: {
          college_id?: string | null
          event_type?: string
          id?: never
          metadata?: Json
          occurred_at?: string
          source_id?: string | null
          source_type?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_activity_events_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_activity_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_badges: {
        Row: {
          awarded_at: string
          badge_slug: string
          id: string
          student_id: string
        }
        Insert: {
          awarded_at?: string
          badge_slug: string
          id?: string
          student_id: string
        }
        Update: {
          awarded_at?: string
          badge_slug?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_badges_badge_slug_fkey"
            columns: ["badge_slug"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "student_badges_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_certifications: {
        Row: {
          created_at: string
          credential_id: string | null
          credential_url: string | null
          expires_on: string | null
          id: string
          issued_on: string | null
          issuer: string | null
          name: string
          source: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credential_id?: string | null
          credential_url?: string | null
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          issuer?: string | null
          name: string
          source?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credential_id?: string | null
          credential_url?: string | null
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          issuer?: string | null
          name?: string
          source?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_certifications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_contact: {
        Row: {
          email: string | null
          github_url: string | null
          linkedin_url: string | null
          phone: string | null
          resume_url: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          email?: string | null
          github_url?: string | null
          linkedin_url?: string | null
          phone?: string | null
          resume_url?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          email?: string | null
          github_url?: string | null
          linkedin_url?: string | null
          phone?: string | null
          resume_url?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_contact_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      student_import_rows: {
        Row: {
          error_message: string | null
          id: string
          import_id: string
          raw_data: Json
          roll_number: string | null
          row_number: number
          student_id: string | null
          validation_status: string
        }
        Insert: {
          error_message?: string | null
          id?: string
          import_id: string
          raw_data?: Json
          roll_number?: string | null
          row_number: number
          student_id?: string | null
          validation_status?: string
        }
        Update: {
          error_message?: string | null
          id?: string
          import_id?: string
          raw_data?: Json
          roll_number?: string | null
          row_number?: number
          student_id?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "student_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_import_rows_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_imports: {
        Row: {
          college_id: string
          completed_at: string | null
          duplicate_rows: number
          file_name: string
          id: string
          invalid_rows: number
          started_at: string
          status: string
          total_rows: number
          uploaded_by: string
          valid_rows: number
        }
        Insert: {
          college_id: string
          completed_at?: string | null
          duplicate_rows?: number
          file_name: string
          id?: string
          invalid_rows?: number
          started_at?: string
          status?: string
          total_rows?: number
          uploaded_by: string
          valid_rows?: number
        }
        Update: {
          college_id?: string
          completed_at?: string | null
          duplicate_rows?: number
          file_name?: string
          id?: string
          invalid_rows?: number
          started_at?: string
          status?: string
          total_rows?: number
          uploaded_by?: string
          valid_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_imports_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      student_intake: {
        Row: {
          created_at: string
          has_seen_welcome: boolean
          intake_completed_at: string | null
          task_source: string | null
          updated_at: string
          user_id: string
          welcome_seen_at: string | null
        }
        Insert: {
          created_at?: string
          has_seen_welcome?: boolean
          intake_completed_at?: string | null
          task_source?: string | null
          updated_at?: string
          user_id: string
          welcome_seen_at?: string | null
        }
        Update: {
          created_at?: string
          has_seen_welcome?: boolean
          intake_completed_at?: string | null
          task_source?: string | null
          updated_at?: string
          user_id?: string
          welcome_seen_at?: string | null
        }
        Relationships: []
      }
      student_interests: {
        Row: {
          branch: string | null
          confirmed_at: string | null
          created_at: string
          id: string
          interests: string[]
          skills: string[]
          student_id: string
          target_role: string | null
          updated_at: string
          year_of_study: string | null
        }
        Insert: {
          branch?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          interests?: string[]
          skills?: string[]
          student_id: string
          target_role?: string | null
          updated_at?: string
          year_of_study?: string | null
        }
        Update: {
          branch?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          interests?: string[]
          skills?: string[]
          student_id?: string
          target_role?: string | null
          updated_at?: string
          year_of_study?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_interests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_levels: {
        Row: {
          attempts: number
          best_score: number
          cleared_at: string | null
          created_at: string
          evidence: string | null
          id: string
          level_id: string
          mastered_at: string | null
          status: string
          student_id: string
          task_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          best_score?: number
          cleared_at?: string | null
          created_at?: string
          evidence?: string | null
          id?: string
          level_id: string
          mastered_at?: string | null
          status?: string
          student_id: string
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          best_score?: number
          cleared_at?: string | null
          created_at?: string
          evidence?: string | null
          id?: string
          level_id?: string
          mastered_at?: string | null
          status?: string
          student_id?: string
          task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_levels_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_levels_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_levels_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      student_portfolios: {
        Row: {
          achievements: string | null
          bio: string | null
          created_at: string
          id: string
          is_public: boolean
          projects: Json | null
          skills: string[]
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
          skills?: string[]
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
          skills?: string[]
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
          ai_personalization_enabled: boolean
          batch: string | null
          branch: string | null
          calibration_completed: boolean
          career_goals: string | null
          college_id: string | null
          created_at: string
          first_task_completed: boolean
          full_name: string
          id: string
          invited_at: string | null
          key_interests: string[]
          last_active: string | null
          onboarded_at: string | null
          onboarding_status: string
          open_to_relocate: boolean
          preferred_locations: string[]
          preferred_skills: string[]
          profile_completed: boolean
          profile_photo_url: string | null
          profile_visibility: string
          roll_number: string | null
          secondary_roles: string[]
          slug: string | null
          source: string | null
          status: string
          target_role: string | null
          total_xp: number
          trust_score: number
          updated_at: string
          user_id: string
          voice_consent_at: string | null
          work_preference: string
          year_of_study: string | null
        }
        Insert: {
          ai_personalization_enabled?: boolean
          batch?: string | null
          branch?: string | null
          calibration_completed?: boolean
          career_goals?: string | null
          college_id?: string | null
          created_at?: string
          first_task_completed?: boolean
          full_name: string
          id?: string
          invited_at?: string | null
          key_interests?: string[]
          last_active?: string | null
          onboarded_at?: string | null
          onboarding_status?: string
          open_to_relocate?: boolean
          preferred_locations?: string[]
          preferred_skills?: string[]
          profile_completed?: boolean
          profile_photo_url?: string | null
          profile_visibility?: string
          roll_number?: string | null
          secondary_roles?: string[]
          slug?: string | null
          source?: string | null
          status?: string
          target_role?: string | null
          total_xp?: number
          trust_score?: number
          updated_at?: string
          user_id: string
          voice_consent_at?: string | null
          work_preference?: string
          year_of_study?: string | null
        }
        Update: {
          ai_personalization_enabled?: boolean
          batch?: string | null
          branch?: string | null
          calibration_completed?: boolean
          career_goals?: string | null
          college_id?: string | null
          created_at?: string
          first_task_completed?: boolean
          full_name?: string
          id?: string
          invited_at?: string | null
          key_interests?: string[]
          last_active?: string | null
          onboarded_at?: string | null
          onboarding_status?: string
          open_to_relocate?: boolean
          preferred_locations?: string[]
          preferred_skills?: string[]
          profile_completed?: boolean
          profile_photo_url?: string | null
          profile_visibility?: string
          roll_number?: string | null
          secondary_roles?: string[]
          slug?: string | null
          source?: string | null
          status?: string
          target_role?: string | null
          total_xp?: number
          trust_score?: number
          updated_at?: string
          user_id?: string
          voice_consent_at?: string | null
          work_preference?: string
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
      student_quests: {
        Row: {
          completed_at: string | null
          id: string
          period_start: string
          progress: number
          quest_slug: string
          student_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          period_start: string
          progress?: number
          quest_slug: string
          student_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          period_start?: string
          progress?: number
          quest_slug?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_quests_quest_slug_fkey"
            columns: ["quest_slug"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "student_quests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_skills: {
        Row: {
          assessed_score: number | null
          claimed_from: string | null
          created_at: string
          id: string
          last_evidence_at: string | null
          proven_lots: number
          proven_voice: number
          skill: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          assessed_score?: number | null
          claimed_from?: string | null
          created_at?: string
          id?: string
          last_evidence_at?: string | null
          proven_lots?: number
          proven_voice?: number
          skill: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          assessed_score?: number | null
          claimed_from?: string | null
          created_at?: string
          id?: string
          last_evidence_at?: string | null
          proven_lots?: number
          proven_voice?: number
          skill?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_skills_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_streaks: {
        Row: {
          current_days: number
          last_active_on: string | null
          longest_days: number
          student_id: string
          updated_at: string
        }
        Insert: {
          current_days?: number
          last_active_on?: string | null
          longest_days?: number
          student_id: string
          updated_at?: string
        }
        Update: {
          current_days?: number
          last_active_on?: string | null
          longest_days?: number
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_streaks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_tracks: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          placed_at_level: number
          student_id: string
          track_slug: string
          unlocked_through: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          placed_at_level?: number
          student_id: string
          track_slug: string
          unlocked_through?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          placed_at_level?: number
          student_id?: string
          track_slug?: string
          unlocked_through?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_tracks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_tracks_track_slug_fkey"
            columns: ["track_slug"]
            isOneToOne: false
            referencedRelation: "level_tracks"
            referencedColumns: ["slug"]
          },
        ]
      }
      student_week_plan: {
        Row: {
          created_at: string
          id: string
          level_id: string
          reason: string
          reason_code: string
          slot: number
          student_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          level_id: string
          reason: string
          reason_code: string
          slot: number
          student_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          level_id?: string
          reason?: string
          reason_code?: string
          slot?: number
          student_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_week_plan_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_week_plan_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_weekly_scores: {
        Row: {
          breakdown: Json
          computed_at: string
          id: string
          points: number
          season_id: string
          squad_id: string | null
          student_id: string
          week: number
        }
        Insert: {
          breakdown?: Json
          computed_at?: string
          id?: string
          points?: number
          season_id: string
          squad_id?: string | null
          student_id: string
          week: number
        }
        Update: {
          breakdown?: Json
          computed_at?: string
          id?: string
          points?: number
          season_id?: string
          squad_id?: string | null
          student_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_weekly_scores_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_weekly_scores_squad_id_fkey"
            columns: ["squad_id"]
            isOneToOne: false
            referencedRelation: "squads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_weekly_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          assigned_at: string
          completed_at: string | null
          feedback: string | null
          id: string
          review_status: string | null
          reviewed_by: string | null
          status: string
          student_id: string
          submitted_at: string | null
          task_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          completed_at?: string | null
          feedback?: string | null
          id?: string
          review_status?: string | null
          reviewed_by?: string | null
          status?: string
          student_id: string
          submitted_at?: string | null
          task_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          completed_at?: string | null
          feedback?: string | null
          id?: string
          review_status?: string | null
          reviewed_by?: string | null
          status?: string
          student_id?: string
          submitted_at?: string | null
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          branch: string | null
          created_at: string
          created_by: string | null
          description: string
          difficulty: string
          id: string
          skills: string[]
          title: string
          updated_at: string
          xp_reward: number
        }
        Insert: {
          branch?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          difficulty?: string
          id?: string
          skills?: string[]
          title: string
          updated_at?: string
          xp_reward?: number
        }
        Update: {
          branch?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          difficulty?: string
          id?: string
          skills?: string[]
          title?: string
          updated_at?: string
          xp_reward?: number
        }
        Relationships: []
      }
      tasks: {
        Row: {
          ai_metadata: Json | null
          approved_by_admin: boolean
          category: string | null
          code_sample: string | null
          completed_at: string | null
          created_at: string
          created_by_admin_id: string | null
          created_by_college_id: string | null
          created_by_startup_id: string | null
          created_by_type: string | null
          description: string | null
          difficulty: string | null
          due_date: string
          duration_days: number | null
          estimate_minutes: number | null
          id: string
          is_ai_generated: boolean
          is_paid: boolean
          level_id: string | null
          lot_category: string | null
          lot_date: string | null
          lot_number: number | null
          posted_at: string
          required_skills: string[]
          roadmap_scorecard_id: string | null
          roadmap_stage_index: number | null
          source: string | null
          source_jd: string | null
          sponsor_criteria: string | null
          sponsored_by: string | null
          started_at: string | null
          status: string
          student_id: string | null
          suggested_xp: number | null
          title: string
          updated_at: string
          upload_deadline: string | null
          visibility: string
          xp: number
          xp_reward: number
        }
        Insert: {
          ai_metadata?: Json | null
          approved_by_admin?: boolean
          category?: string | null
          code_sample?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          created_by_college_id?: string | null
          created_by_startup_id?: string | null
          created_by_type?: string | null
          description?: string | null
          difficulty?: string | null
          due_date?: string
          duration_days?: number | null
          estimate_minutes?: number | null
          id?: string
          is_ai_generated?: boolean
          is_paid?: boolean
          level_id?: string | null
          lot_category?: string | null
          lot_date?: string | null
          lot_number?: number | null
          posted_at?: string
          required_skills?: string[]
          roadmap_scorecard_id?: string | null
          roadmap_stage_index?: number | null
          source?: string | null
          source_jd?: string | null
          sponsor_criteria?: string | null
          sponsored_by?: string | null
          started_at?: string | null
          status?: string
          student_id?: string | null
          suggested_xp?: number | null
          title: string
          updated_at?: string
          upload_deadline?: string | null
          visibility?: string
          xp?: number
          xp_reward?: number
        }
        Update: {
          ai_metadata?: Json | null
          approved_by_admin?: boolean
          category?: string | null
          code_sample?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          created_by_college_id?: string | null
          created_by_startup_id?: string | null
          created_by_type?: string | null
          description?: string | null
          difficulty?: string | null
          due_date?: string
          duration_days?: number | null
          estimate_minutes?: number | null
          id?: string
          is_ai_generated?: boolean
          is_paid?: boolean
          level_id?: string | null
          lot_category?: string | null
          lot_date?: string | null
          lot_number?: number | null
          posted_at?: string
          required_skills?: string[]
          roadmap_scorecard_id?: string | null
          roadmap_stage_index?: number | null
          source?: string | null
          source_jd?: string | null
          sponsor_criteria?: string | null
          sponsored_by?: string | null
          started_at?: string | null
          status?: string
          student_id?: string | null
          suggested_xp?: number | null
          title?: string
          updated_at?: string
          upload_deadline?: string | null
          visibility?: string
          xp?: number
          xp_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "tasks_created_by_college_id_fkey"
            columns: ["created_by_college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_roadmap_scorecard_id_fkey"
            columns: ["roadmap_scorecard_id"]
            isOneToOne: false
            referencedRelation: "resume_scorecards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_sponsored_by_fkey"
            columns: ["sponsored_by"]
            isOneToOne: false
            referencedRelation: "recruiters"
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
      thread_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          thread_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          thread_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_posts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "topic_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_threads: {
        Row: {
          created_at: string
          id: string
          level_id: string
          post_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          level_id: string
          post_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          level_id?: string
          post_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "topic_threads_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: true
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      track_phases: {
        Row: {
          created_at: string
          from_level: number
          goal: string | null
          id: string
          name: string
          phase_number: number
          to_level: number
          track_slug: string
        }
        Insert: {
          created_at?: string
          from_level: number
          goal?: string | null
          id?: string
          name: string
          phase_number: number
          to_level: number
          track_slug: string
        }
        Update: {
          created_at?: string
          from_level?: number
          goal?: string | null
          id?: string
          name?: string
          phase_number?: number
          to_level?: number
          track_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "track_phases_track_slug_fkey"
            columns: ["track_slug"]
            isOneToOne: false
            referencedRelation: "level_tracks"
            referencedColumns: ["slug"]
          },
        ]
      }
      trust_scores: {
        Row: {
          ai_authorship_score: number | null
          cognitive_integrity_score: number | null
          commit_authenticity_score: number | null
          conceptual_understanding_score: number | null
          created_at: string
          id: string
          last_updated: string
          proof_id: string | null
          score: number
          student_id: string
        }
        Insert: {
          ai_authorship_score?: number | null
          cognitive_integrity_score?: number | null
          commit_authenticity_score?: number | null
          conceptual_understanding_score?: number | null
          created_at?: string
          id?: string
          last_updated?: string
          proof_id?: string | null
          score?: number
          student_id: string
        }
        Update: {
          ai_authorship_score?: number | null
          cognitive_integrity_score?: number | null
          commit_authenticity_score?: number | null
          conceptual_understanding_score?: number | null
          created_at?: string
          id?: string
          last_updated?: string
          proof_id?: string | null
          score?: number
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_scores_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_uploads"
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
      user_preferences: {
        Row: {
          compact_mode: boolean
          created_at: string
          email_notifications: boolean
          id: string
          portfolio_public: boolean
          push_notifications: boolean
          show_progress_to_others: boolean
          show_xp_rank: boolean
          task_reminders: boolean
          theme: string | null
          updated_at: string
          user_id: string
          weekly_digest: boolean
        }
        Insert: {
          compact_mode?: boolean
          created_at?: string
          email_notifications?: boolean
          id?: string
          portfolio_public?: boolean
          push_notifications?: boolean
          show_progress_to_others?: boolean
          show_xp_rank?: boolean
          task_reminders?: boolean
          theme?: string | null
          updated_at?: string
          user_id: string
          weekly_digest?: boolean
        }
        Update: {
          compact_mode?: boolean
          created_at?: string
          email_notifications?: boolean
          id?: string
          portfolio_public?: boolean
          push_notifications?: boolean
          show_progress_to_others?: boolean
          show_xp_rank?: boolean
          task_reminders?: boolean
          theme?: string | null
          updated_at?: string
          user_id?: string
          weekly_digest?: boolean
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
      verification_settings: {
        Row: {
          auto_approve_threshold: number
          college_id: string
          created_at: string
          id: string
          min_ai_likelihood: number
          min_authenticity_score: number
          min_conceptual_score: number
          min_trust_score: number
          updated_at: string
        }
        Insert: {
          auto_approve_threshold?: number
          college_id: string
          created_at?: string
          id?: string
          min_ai_likelihood?: number
          min_authenticity_score?: number
          min_conceptual_score?: number
          min_trust_score?: number
          updated_at?: string
        }
        Update: {
          auto_approve_threshold?: number
          college_id?: string
          created_at?: string
          id?: string
          min_ai_likelihood?: number
          min_authenticity_score?: number
          min_conceptual_score?: number
          min_trust_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_settings_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: true
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_explanations: {
        Row: {
          communication_notes: string | null
          communication_score: number | null
          created_at: string
          duration_seconds: number | null
          id: string
          proof_id: string | null
          status: string
          storage_path: string
          student_id: string
          task_id: string | null
          transcript: string | null
          transcript_source: string
          word_count: number | null
        }
        Insert: {
          communication_notes?: string | null
          communication_score?: number | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          proof_id?: string | null
          status?: string
          storage_path: string
          student_id: string
          task_id?: string | null
          transcript?: string | null
          transcript_source?: string
          word_count?: number | null
        }
        Update: {
          communication_notes?: string | null
          communication_score?: number | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          proof_id?: string | null
          status?: string
          storage_path?: string
          student_id?: string
          task_id?: string | null
          transcript?: string | null
          transcript_source?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_explanations_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_explanations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_explanations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
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
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_users: {
        Row: {
          created_at: string | null
          email: string | null
          id: string | null
          last_sign_in_at: string | null
          name: string | null
          role: string | null
          status: string | null
        }
        Relationships: []
      }
      llm_usage_by_student: {
        Row: {
          calls: number | null
          completion_tokens: number | null
          email: string | null
          feature: string | null
          full_name: string | null
          last_used: string | null
          prompt_tokens: number | null
          provider: string | null
          student_id: string | null
          total_tokens: number | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_usage_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      public_resume_scorecards: {
        Row: {
          ats_match_score: number | null
          coding_score: number | null
          created_at: string | null
          interview_readiness_score: number | null
          project_proof_score: number | null
          reasoning_score: number | null
          resume_quality_score: number | null
          roadmap: string | null
          skill_gap: Json | null
          skill_proof_score: number | null
          student_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resume_scorecards_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_voice_consent: { Args: never; Returns: string }
      admin_notify_student: {
        Args: {
          _link?: string
          _message: string
          _student_id: string
          _title: string
          _type?: string
        }
        Returns: undefined
      }
      admin_recruiters: {
        Args: never
        Returns: {
          company: string
          contact_name: string
          created_at: string
          id: string
          shortlists: number
          sponsored: number
          verified: boolean
          website: string
          work_email: string
        }[]
      }
      admin_verify_recruiter: {
        Args: { _recruiter_id: string; _verified: boolean }
        Returns: Json
      }
      assign_to_squad: {
        Args: { _effective?: string; _squad_id: string; _student_id: string }
        Returns: Json
      }
      assign_todays_lots: { Args: never; Returns: Json }
      backfill_rounds: { Args: { _season_id: string }; Returns: Json }
      bump_llm_cache_hit: { Args: { p_hash: string }; Returns: undefined }
      check_rate_limit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_subject: string
          p_window_seconds: number
        }
        Returns: Json
      }
      claim_lot_template: { Args: { _level_id: string }; Returns: string }
      close_season: { Args: { _season_id: string }; Returns: Json }
      complete_own_wizard: { Args: never; Returns: undefined }
      cosign_proof: {
        Args: { _note?: string; _proof_id: string }
        Returns: Json
      }
      cosignable_proofs: {
        Args: never
        Returns: {
          proof_id: string
          status: string
          student_id: string
          student_name: string
          submitted_at: string
          work: string
        }[]
      }
      create_lot_for: {
        Args: { _for_date?: string; _student_id: string }
        Returns: Json
      }
      create_my_lot: { Args: never; Returns: Json }
      ensure_and_claim_lot_template: {
        Args: { _level_id: string }
        Returns: string
      }
      extend_all_fixtures: { Args: never; Returns: Json }
      extend_fixtures: { Args: { _season_id: string }; Returns: Json }
      form_all_colleges: { Args: never; Returns: Json }
      form_squads: {
        Args: { _college_id: string; _season_id?: string }
        Returns: Json
      }
      generate_round_robin: {
        Args: { _force?: boolean; _from_round?: number; _season_id: string }
        Returns: Json
      }
      get_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          full_name: string
          id: string
          profile_photo_url: string
          rank: number
          total_xp: number
          trust_score: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      head_to_head: {
        Args: { _a: string; _b: string; _season: string }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_verified_recruiter: { Args: never; Returns: boolean }
      log_activity: {
        Args: {
          _event_type: string
          _metadata?: Json
          _source_id?: string
          _source_type?: string
          _student_id: string
        }
        Returns: undefined
      }
      log_security_event: {
        Args: {
          p_detail?: Json
          p_email?: string
          p_event_type: string
          p_ip?: string
          p_severity?: string
          p_source?: string
          p_user_agent?: string
          p_user_id?: string
        }
        Returns: undefined
      }
      lot_needs_writer: { Args: { _task_id: string }; Returns: boolean }
      my_college_id: { Args: never; Returns: string }
      my_cosigns: {
        Args: never
        Returns: {
          cosign_id: string
          cosigner_name: string
          cosigner_role: string
          created_at: string
          direction: string
          note: string
          proof_id: string
          student_name: string
          work: string
        }[]
      }
      my_history: {
        Args: { _limit?: number; _offset?: number }
        Returns: {
          event_type: string
          metadata: Json
          occurred_at: string
          source_id: string
          source_type: string
          total: number
        }[]
      }
      my_placement_status: { Args: never; Returns: Json }
      my_recruiter_id: { Args: never; Returns: string }
      my_season_report: { Args: { _season_id?: string }; Returns: Json }
      my_shortlists: {
        Args: never
        Returns: {
          company: string
          created_at: string
          id: string
          note: string
          stage: string
          student_response: string
        }[]
      }
      my_skills_proved: {
        Args: never
        Returns: {
          assessed_score: number
          claimed_from: string
          last_evidence_at: string
          needs_improvement: boolean
          proven_lots: number
          proven_voice: number
          skill: string
          status: string
          topics_cleared: number
          topics_total: number
        }[]
      }
      my_squad_achievements: {
        Args: never
        Returns: {
          achieved_at: string
          detail: string
          kind: string
          title: string
        }[]
      }
      my_suggested_tracks: {
        Args: { _limit?: number }
        Returns: {
          emoji: string
          from_interest: boolean
          match_pct: number
          matched_skills: string[]
          matched_steps: number
          name: string
          reason: string
          role: string
          slug: string
          total_steps: number
        }[]
      }
      my_todays_lot: {
        Args: never
        Returns: {
          code_sample: string
          description: string
          difficulty: string
          due_date: string
          estimate_minutes: number
          id: string
          lot_category: string
          lot_number: number
          source_jd: string
          sponsored_by_company: string
          status: string
          title: string
        }[]
      }
      my_week: {
        Args: never
        Returns: {
          level_id: string
          level_number: number
          reason: string
          reason_code: string
          skill: string
          slot: number
          status: string
          title: string
        }[]
      }
      next_lot_level: { Args: { _student_id: string }; Returns: string }
      notify_all_admins: {
        Args: {
          _link?: string
          _message: string
          _title: string
          _type?: string
        }
        Returns: undefined
      }
      notify_retest_unlocks: { Args: never; Returns: Json }
      notify_weekly_progress: { Args: never; Returns: number }
      plan_all_weeks: { Args: never; Returns: Json }
      plan_student_week: {
        Args: { _student_id: string; _week_start?: string }
        Returns: number
      }
      prune_rate_limits: { Args: never; Returns: undefined }
      record_activity: {
        Args: { _metric: string; _student_id: string }
        Returns: undefined
      }
      record_outcome: {
        Args: { _outcome: string; _student_id: string }
        Returns: Json
      }
      recount_season: { Args: { _season_id: string }; Returns: undefined }
      recruiter_filters: { Args: never; Returns: Json }
      recruiter_home: { Args: never; Returns: Json }
      recruiter_log_view: { Args: { _student_id: string }; Returns: undefined }
      recruiter_lots: {
        Args: never
        Returns: {
          ai_score: number
          created_at: string
          due_date: string
          outcome: string
          proof_id: string
          proof_status: string
          student_id: string
          student_name: string
          submitted_at: string
          task_id: string
          task_status: string
          title: string
        }[]
      }
      recruiter_proof_profile: { Args: { _student_id: string }; Returns: Json }
      recruiter_shortlist: {
        Args: { _note?: string; _student_id: string }
        Returns: Json
      }
      recruiter_talent: {
        Args: {
          _active_within?: number
          _branch?: string
          _limit?: number
          _min_comms?: number
          _min_skill?: number
          _offset?: number
          _role?: string
          _skills?: string[]
        }
        Returns: {
          active_weeks: number
          batch: string
          branch: string
          comms_score: number
          days_since_active: number
          explanations: number
          full_name: string
          lots_done: number
          proofs_verified: number
          season_points: number
          shortlisted: boolean
          skills_proven: number
          skills_total: number
          squad_name: string
          squad_rank: number
          student_id: string
          target_role: string
          top_skills: string[]
          total_matches: number
          total_xp: number
          trust_score: number
        }[]
      }
      refresh_unlock: {
        Args: { _student_id: string; _track: string }
        Returns: number
      }
      release_lot_template: {
        Args: { _level_id: string; _token: string }
        Returns: undefined
      }
      reshuffle_quiz_options: { Args: never; Returns: Json }
      respond_to_shortlist: {
        Args: { _accept: boolean; _shortlist_id: string }
        Returns: Json
      }
      run_all_seasons: { Args: never; Returns: Json }
      run_squad_week: {
        Args: { _season_id: string; _week?: number }
        Returns: Json
      }
      save_lot_template: {
        Args: {
          _code_sample: string
          _difficulty: string
          _estimate_minutes: number
          _level_id: string
          _lot_category: string
          _scenario: string
          _source_jd: string
          _title: string
          _token: string
        }
        Returns: boolean
      }
      score_student_week: {
        Args: { _season_id: string; _student_id: string; _week: number }
        Returns: Json
      }
      season_week: { Args: { _season_id: string }; Returns: number }
      season_week_bounds: {
        Args: { _season_id: string; _week: number }
        Returns: {
          ends_at: string
          starts_at: string
        }[]
      }
      seed_lot_template: { Args: { _level_id: string }; Returns: undefined }
      set_proof_publicity: {
        Args: { p_is_public: boolean; p_proof_id: string }
        Returns: undefined
      }
      settle_round: {
        Args: { _round: number; _season_id: string }
        Returns: number
      }
      sponsor_lot: {
        Args: {
          _brief: string
          _criteria?: string
          _days?: number
          _student_id: string
          _title: string
        }
        Returns: Json
      }
      squad_town: { Args: { _college_id: string }; Returns: string }
      student_is_discoverable: {
        Args: { _student_id: string }
        Returns: boolean
      }
      suggest_tracks: {
        Args: { _limit?: number; _student_id: string }
        Returns: {
          emoji: string
          from_interest: boolean
          match_pct: number
          matched_skills: string[]
          matched_steps: number
          name: string
          reason: string
          role: string
          slug: string
          total_steps: number
        }[]
      }
      template_key: {
        Args: {
          _extra?: string
          _kind: string
          _role: string
          _skills: string[]
        }
        Returns: string
      }
      touch_lot_template: {
        Args: { _level_id: string; _token: string }
        Returns: boolean
      }
      touch_my_activity: { Args: never; Returns: undefined }
      touch_streak: { Args: { _student_id: string }; Returns: undefined }
      touch_template: { Args: { _key: string }; Returns: undefined }
      tpo_attention: {
        Args: never
        Returns: {
          branch: string
          days_quiet: number
          full_name: string
          reason_codes: string[]
          reasons: string[]
          roll_number: string
          severity: string
          student_id: string
        }[]
      }
      tpo_college_report: { Args: never; Returns: Json }
      tpo_form_squads: { Args: never; Returns: Json }
      tpo_generate_fixtures: { Args: { _force?: boolean }; Returns: Json }
      tpo_home: { Args: never; Returns: Json }
      tpo_insights: { Args: never; Returns: Json }
      tpo_placement_report: { Args: never; Returns: Json }
      tpo_rebalance_squads: { Args: never; Returns: Json }
      tpo_run_week: { Args: { _week?: number }; Returns: Json }
      tpo_send_reminder: {
        Args: { _message?: string; _reason: string; _student_id: string }
        Returns: Json
      }
      tpo_squad_achievements: {
        Args: never
        Returns: {
          archived: boolean
          best_rank: number
          best_week_points: number
          draws: number
          is_locked: boolean
          losses: number
          member_badges: number
          squad_id: string
          squad_name: string
          weeks_led: number
          wins: number
        }[]
      }
      tpo_squad_performance: {
        Args: { _weeks?: number }
        Returns: {
          active_members: number
          change: number
          participation: number
          points: number
          rank: number
          squad_id: string
          squad_name: string
          total_members: number
          week: number
        }[]
      }
      tpo_squad_update: {
        Args: {
          _archived?: boolean
          _is_locked?: boolean
          _max_members?: number
          _name?: string
          _squad_id: string
        }
        Returns: Json
      }
      tpo_student_filters: { Args: never; Returns: Json }
      tpo_student_profile: { Args: { _student_id: string }; Returns: Json }
      tpo_students: {
        Args: {
          _batch?: string
          _branch?: string
          _limit?: number
          _offset?: number
          _search?: string
          _skill?: string
          _squad?: string
          _status?: string
        }
        Returns: {
          attention: string
          batch: string
          branch: string
          days_quiet: number
          email: string
          full_name: string
          gap_skills: string[]
          is_reserve: boolean
          lots_done: number
          onboarding_status: string
          roll_number: string
          squad_id: string
          squad_name: string
          student_id: string
          total_count: number
          total_xp: number
          trust_score: number
        }[]
      }
      unlock_ceiling: {
        Args: { _student_id: string; _track: string }
        Returns: number
      }
      viewer_college_id: { Args: never; Returns: string }
      write_audit: {
        Args: {
          _action: string
          _college?: string
          _new?: Json
          _old?: Json
          _record: string
          _table: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "student" | "college_admin" | "startup" | "admin" | "recruiter"
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
      app_role: ["student", "college_admin", "startup", "admin", "recruiter"],
    },
  },
} as const
