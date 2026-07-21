
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { startOfMonth, endOfMonth } from "date-fns";

export interface ProofUpload {
  id: string;
  task_id: string;
  student_id: string;
  file_url: string | null;
  submission_notes: string | null;
  // Widened from a 3-value union: trust-compute also writes 'needs_review',
  // so the old union did not match what the database actually stores.
  status: string;
  submitted_at: string;
  is_public: boolean;
  // Verification results the student is allowed to see for their own proofs.
  ai_score: number | null;
  ai_summary: string | null;
  ai_feedback: string | null;
  review_comment: string | null;
  admin_review_status: string | null;
  tasks?: {
    title: string;
    xp_reward?: number;
    xp?: number;
  };
  github_verifications?: {
    authenticity_score: number | null;
    commit_count: number | null;
    unique_contributors: number | null;
    first_commit_at: string | null;
    last_commit_at: string | null;
  }[];
}

export const useProofUploads = (currentDate: Date) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['proof-uploads', user?.id, currentDate.getMonth(), currentDate.getFullYear()],
    queryFn: async () => {
      if (!user) return [];

      // Get student profile ID first
      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) return [];

      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);

      const { data, error } = await supabase
        .from('proof_uploads')
        .select(`
          *,
          tasks:task_id (
            title,
            xp_reward,
            xp
          ),
          github_verifications (
            authenticity_score,
            commit_count,
            unique_contributors,
            first_commit_at,
            last_commit_at
          )
        `)
        .eq('student_id', profile.id)
        .gte('submitted_at', monthStart.toISOString())
        .lte('submitted_at', monthEnd.toISOString())
        .order('submitted_at', { ascending: false });

      if (error) {
        console.error('Error fetching proof uploads:', error);
        throw error;
      }

      return data || [];
    },
    enabled: !!user,
  });
};
