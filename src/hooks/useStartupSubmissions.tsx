import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface StartupSubmission {
  id: string;
  task_id: string;
  student_id: string;
  file_url: string | null;
  submission_notes: string | null;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_comment: string | null;
  tasks: {
    title: string;
    description: string | null;
    xp_reward: number;
  } | null;
  student_profiles: {
    full_name: string;
    email: string;
    profile_photo_url: string | null;
  } | null;
}

export function useStartupSubmissions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['startup-submissions', user?.id],
    queryFn: async () => {
      if (!user) return [];

      // First, get all task IDs created by this startup
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('id')
        .eq('created_by_startup_id', user.id);

      if (tasksError) throw tasksError;
      if (!tasks || tasks.length === 0) return [];

      const taskIds = tasks.map(t => t.id);

      // Now fetch proof uploads for these tasks
      const { data, error } = await supabase
        .from('proof_uploads')
        .select(`
          *,
          tasks:task_id (
            title,
            description,
            xp_reward
          ),
          student_profiles:student_id (
            full_name,
            email,
            profile_photo_url
          )
        `)
        .in('task_id', taskIds)
        .order('submitted_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
}

export function useReviewSubmission() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      submissionId, 
      status, 
      reviewComment 
    }: { 
      submissionId: string; 
      status: 'Verified' | 'Rejected'; 
      reviewComment?: string;
    }) => {
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('proof_uploads')
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
          review_comment: reviewComment || null,
        })
        .eq('id', submissionId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Submission ${data.status.toLowerCase()} successfully!`);
      queryClient.invalidateQueries({ queryKey: ['startup-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['startup-stats'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to review submission');
    },
  });
}

export type { StartupSubmission };