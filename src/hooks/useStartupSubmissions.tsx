import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Student work on this company's own posted and sponsored tasks.
 *
 * Read from task_submissions through company_submissions() (migration 54), the
 * same evidence the student's Build-log and their college see: the graded answer
 * or code, its score, and the student's spoken explanation. This used to read
 * proof_uploads, which students no longer write, so it was always empty (L1).
 */
export interface CompanySubmission {
  submission_id: string;
  task_id: string;
  task_title: string;
  source: "posted" | "sponsored";
  student_id: string;
  student_name: string;
  college_name: string | null;
  status: string;               // passed | failed | needs_review
  score: number | null;
  passed_count: number | null;
  total_count: number | null;
  kind: "code" | "written";
  language: string | null;
  work: string | null;
  submitted_at: string;
  attempts: number;
  voice_status: string | null;  // pending | scored | failed | null (not recorded)
  voice_score: number | null;
  voice_notes: string | null;
  voice_transcript: string | null;
  review_decision: "accepted" | "needs_work" | "rejected" | null;
  review_note: string | null;
  reviewed_at: string | null;
}

export type ReviewDecision = "accepted" | "needs_work" | "rejected";

export function useStartupSubmissions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["startup-submissions", user?.id],
    queryFn: async (): Promise<CompanySubmission[]> => {
      if (!user) return [];
      const { data, error } = await supabase.rpc("company_submissions" as never);
      if (error) throw error;
      return (data as unknown as CompanySubmission[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useReviewSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ submissionId, decision, note }: { submissionId: string; decision: ReviewDecision; note?: string }) => {
      const { error } = await supabase.rpc("company_review_submission" as never, {
        _submission_id: submissionId, _decision: decision, _note: note ?? null,
      } as never);
      if (error) throw error;
      return decision;
    },
    onSuccess: (decision) => {
      toast.success(decision === "accepted" ? "Marked as accepted" : decision === "needs_work" ? "Marked as needs work" : "Marked as rejected");
      queryClient.invalidateQueries({ queryKey: ["startup-submissions"] });
      queryClient.invalidateQueries({ queryKey: ["startup-stats"] });
    },
    onError: (error: Error) => toast.error(error.message || "Could not save the review"),
  });
}
