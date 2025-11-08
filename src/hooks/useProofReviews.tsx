import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ProofReview {
  id: string;
  student_id: string;
  task_id: string;
  file_url: string | null;
  submission_notes: string | null;
  status: 'Under Review' | 'Verified' | 'Rejected';
  submitted_at: string;
  review_comment: string | null;
  reviewed_by: string | null;
  admin_review_status: string | null;
  ai_score: number | null;
  ai_summary: string | null;
  ai_feedback: string | null;
  ai_status: string | null;
  github_verifications?: {
    authenticity_score: number | null;
    commit_count: number | null;
    unique_contributors: number | null;
    first_commit_at: string | null;
    last_commit_at: string | null;
    largest_commit_delta: number | null;
  }[];
  ai_verifications?: {
    originality_score: number | null;
    ai_authorship_risk: number | null;
    ai_summary: string | null;
    ai_comments: string | null;
  }[];
  trust_scores?: {
    score: number | null;
    last_updated: string | null;
  }[];
  conceptual_tests?: {
    proof_id: string;
    status: string;
    answer_scores: any;
  }[];
  student: {
    full_name: string;
    email: string;
  };
  task: {
    title: string;
    xp_reward: number;
  };
}

export const useProofReviews = () => {
  return useQuery({
    queryKey: ['proof-reviews'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('proof_uploads')
          .select(`
            *,
            student_profiles!inner (
              full_name,
              email
            ),
            tasks!inner (
              title,
              xp_reward
            ),
            github_verifications (
              authenticity_score,
              commit_count,
              unique_contributors,
              first_commit_at,
              last_commit_at,
              largest_commit_delta
            ),
            ai_verifications (
              originality_score,
              ai_authorship_risk,
              ai_summary,
              ai_comments
            ),
            trust_scores (
              score,
              last_updated
            ),
            conceptual_tests (
              proof_id,
              status,
              answer_scores
            )
          `)
          .order('submitted_at', { ascending: false });

        if (error) {
          console.error('Error fetching proof reviews:', error);
          // If auth error and we're in development mode, return empty array
          if (error.code === 'PGRST301') {
            console.log('Auth bypassed - returning empty proof reviews');
            return [];
          }
          throw error;
        }

        return data?.map(item => ({
          ...item,
          student: item.student_profiles,
          task: item.tasks
        })) as ProofReview[] || [];
      } catch (error) {
        console.error('Proof reviews query error:', error);
        return [];
      }
    },
  });
};

export const useUpdateProofStatus = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      proofId, 
      status, 
      comment,
      studentId,
      xpReward 
    }: { 
      proofId: string; 
      status: string; 
      comment?: string;
      studentId: string;
      xpReward: number;
    }) => {
      // Update proof status
      const { error: proofError } = await supabase
        .from('proof_uploads')
        .update({
          status,
          review_comment: comment,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', proofId);

      if (proofError) throw proofError;

      // If verified, award XP
      if (status === 'Verified' && xpReward > 0) {
        // Add XP log
        const { error: xpError } = await supabase
          .from('xp_logs')
          .insert({
            student_id: studentId,
            xp_points: xpReward,
            source: 'Task Verification'
          });

        if (xpError) throw xpError;

        // Update student total XP
        const { data: currentProfile } = await supabase
          .from('student_profiles')
          .select('total_xp')
          .eq('id', studentId)
          .single();

        if (currentProfile) {
          await supabase
            .from('student_profiles')
            .update({
              total_xp: (currentProfile.total_xp || 0) + xpReward
            })
            .eq('id', studentId);
        }
      }

      return { proofId, status };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['proof-reviews'] });
      toast({
        title: "Status Updated",
        description: `Proof has been ${data.status.toLowerCase()}.`,
      });
    },
    onError: (error) => {
      console.error('Error updating proof status:', error);
      toast({
        title: "Error",
        description: "Failed to update proof status.",
        variant: "destructive",
      });
    },
  });
};
