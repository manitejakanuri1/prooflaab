import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface AppealForReview {
  id: string;
  proof_id: string;
  student_id: string;
  appeal_reason: string;
  appeal_status: string;
  reviewer_decision: string | null;
  reviewer_comment: string | null;
  reviewed_at: string | null;
  created_at: string;
  student_profiles?: {
    full_name: string;
    email: string;
    profile_photo_url: string | null;
  } | null;
  proof_uploads?: {
    id: string;
    status: string;
    file_url: string | null;
    review_comment: string | null;
    ai_score: number | null;
    submitted_at: string | null;
    tasks?: { title: string } | null;
  } | null;
}

/**
 * Appeals queue for reviewers (admin + college_admin).
 *
 * No role filtering is done here on purpose — RLS already scopes the rows:
 * admins see every appeal, college admins see only appeals from students at
 * their college. The same query therefore serves both dashboards.
 */
export const useAppealsReview = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: appeals, isLoading, error, refetch } = useQuery({
    queryKey: ['appeals-review'],
    queryFn: async (): Promise<AppealForReview[]> => {
      const { data, error } = await supabase
        .from('proof_appeals')
        .select(`
          *,
          student_profiles:student_id (
            full_name,
            email,
            profile_photo_url
          ),
          proof_uploads:proof_id (
            id,
            status,
            file_url,
            review_comment,
            ai_score,
            submitted_at,
            tasks:task_id ( title )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as AppealForReview[];
    },
  });

  const reviewAppeal = useMutation({
    mutationFn: async ({
      appealId,
      proofId,
      decision,
      comment,
      reviewerId,
    }: {
      appealId: string;
      proofId: string;
      decision: 'approved' | 'rejected';
      comment: string;
      reviewerId: string;
    }) => {
      // 1. Record the decision on the appeal itself.
      const { error: appealError } = await supabase
        .from('proof_appeals')
        .update({
          appeal_status: decision,
          reviewer_decision: decision,
          reviewer_comment: comment,
          reviewed_by: reviewerId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', appealId);

      if (appealError) throw appealError;

      // 2. An approved appeal has to actually change the outcome, otherwise the
      //    student sees "appeal approved" while their proof stays Rejected.
      //    Updating proof_uploads also fires the existing notification triggers
      //    (proof_status_update_notification / trigger_proof_review_notification),
      //    which is how the student gets told — the client cannot INSERT into
      //    `notifications` directly, there is no INSERT policy for it.
      if (decision === 'approved') {
        const { error: proofError } = await supabase
          .from('proof_uploads')
          .update({
            status: 'Verified',
            admin_review_status: 'Approved',
            review_flag: false,
            review_override_reason: comment,
            reviewed_by: reviewerId,
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', proofId);

        if (proofError) throw proofError;
      }

      return { appealId, decision };
    },
    onSuccess: ({ decision }) => {
      queryClient.invalidateQueries({ queryKey: ['appeals-review'] });
      queryClient.invalidateQueries({ queryKey: ['proof-appeals'] });
      queryClient.invalidateQueries({ queryKey: ['proof-uploads'] });
      toast({
        title: decision === 'approved' ? "Appeal approved" : "Appeal rejected",
        description:
          decision === 'approved'
            ? "The proof has been marked Verified and the student notified."
            : "The decision was recorded and the student notified.",
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to review appeal",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return { appeals, isLoading, error, refetch, reviewAppeal };
};
