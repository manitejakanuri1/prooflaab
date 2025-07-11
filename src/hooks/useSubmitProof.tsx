import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface SubmitProofData {
  taskId: string;
  fileUrl: string;
  submissionNotes?: string;
}

export const useSubmitProof = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, fileUrl, submissionNotes }: SubmitProofData) => {
      if (!user) throw new Error('User not authenticated');

      // Get student profile ID
      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) throw new Error('Student profile not found');

      // Insert proof upload record
      const { data, error } = await supabase
        .from('proof_uploads')
        .insert({
          task_id: taskId,
          student_id: profile.id,
          file_url: fileUrl,
          submission_notes: submissionNotes || null,
          status: 'Under Review'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Invalidate related queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['proof-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['assigned-tasks'] });
    },
  });
};