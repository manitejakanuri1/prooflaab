
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface AssignedTask {
  id: string;
  title: string;
  deadline: string;
  status: 'Pending' | 'In Progress' | 'Completed';
  progress: number;
  description?: string;
  xp_reward?: number;
  started_at?: string;
  duration_days?: number;
  upload_deadline?: string;
  can_start?: boolean;
}

export const useAssignedTasks = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['assigned-tasks', user?.id],
    queryFn: async () => {
      if (!user) throw new Error("No authenticated user");

      // Get student profile to get student_id
      const { data: profile, error: profileError } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (profileError) throw profileError;

      // Fetch tasks for this student
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('student_id', profile.id)
        .order('due_date', { ascending: true });

      if (tasksError) throw tasksError;

      // Transform data to match our interface
      const transformedTasks: AssignedTask[] = (tasksData || []).map(task => {
        const now = new Date();
        const dueDate = new Date(task.due_date);
        const uploadDeadline = task.upload_deadline ? new Date(task.upload_deadline) : null;
        
        // Check if task should revert to pending due to missed deadline
        let currentStatus = task.status;
        if (task.started_at && uploadDeadline && now > uploadDeadline && task.status === 'In Progress') {
          currentStatus = 'Pending';
        }
        
        return {
          id: task.id,
          title: task.title,
          deadline: dueDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          }),
          status: currentStatus as 'Pending' | 'In Progress' | 'Completed',
          progress: calculateProgress(currentStatus),
          description: task.description,
          xp_reward: task.xp_reward,
          started_at: task.started_at,
          duration_days: task.duration_days,
          upload_deadline: uploadDeadline?.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          }),
          can_start: !task.started_at && currentStatus === 'Pending'
        };
      });

      return transformedTasks;
    },
    enabled: !!user,
  });

  const { data, isLoading: loading, error } = query;

  // Calculate progress based on status since we don't have a progress field in tasks table
  const calculateProgress = (status: string): number => {
    switch (status) {
      case 'Completed':
        return 100;
      case 'In Progress':
        return 50;
      default:
        return 0;
    }
  };

  const startTask = async (taskId: string) => {
    const { error } = await supabase
      .from('tasks')
      .update({ 
        started_at: new Date().toISOString()
      })
      .eq('id', taskId);

    if (error) throw error;

    // Invalidate queries to refresh data
    queryClient.invalidateQueries({ queryKey: ['assigned-tasks'] });
  };

  return { 
    tasks: data || [], 
    loading, 
    error: error?.message || '', 
    startTask,
    refetch: query.refetch
  };
};
