import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useProofAppeals = (studentId?: string) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: appeals, isLoading } = useQuery({
    queryKey: ['proof-appeals', studentId],
    queryFn: async () => {
      const query = supabase
        .from('proof_appeals')
        .select(`
          *,
          proof_uploads(task_id, tasks(title))
        `)
        .order('created_at', { ascending: false });
      
      if (studentId) {
        query.eq('student_id', studentId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!studentId,
  });

  const createAppeal = useMutation({
    mutationFn: async ({ proofId, studentId, reason }: { proofId: string; studentId: string; reason: string }) => {
      const { data, error } = await supabase
        .from('proof_appeals')
        .insert({
          proof_id: proofId,
          student_id: studentId,
          appeal_reason: reason,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proof-appeals'] });
      toast({
        title: "Appeal Submitted",
        description: "Your appeal has been submitted for review.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Submit Appeal",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reviewAppeal = useMutation({
    mutationFn: async ({ appealId, decision, comment, reviewerId }: { 
      appealId: string; 
      decision: string; 
      comment: string; 
      reviewerId: string 
    }) => {
      const { data, error } = await supabase
        .from('proof_appeals')
        .update({
          appeal_status: decision,
          reviewer_decision: decision,
          reviewer_comment: comment,
          reviewed_by: reviewerId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', appealId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proof-appeals'] });
      toast({
        title: "Appeal Reviewed",
        description: "Appeal decision has been recorded.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Review Appeal",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    appeals,
    isLoading,
    createAppeal,
    reviewAppeal,
  };
};
