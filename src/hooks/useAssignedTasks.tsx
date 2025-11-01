
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface AssignedTask {
  id: string;
  title: string;
  deadline: string;
  due_date?: string; // Raw date from database
  status: 'Pending' | 'In Progress' | 'Completed' | 'Under Review';
  progress: number;
  description?: string;
  xp_reward?: number;
  started_at?: string;
  duration_days?: number;
  upload_deadline?: string;
  can_start?: boolean;
  proof_submitted?: boolean;
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

      // Fetch tasks with proof upload status
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select(`
          *,
          proof_uploads (
            id,
            status,
            submitted_at
          )
        `)
        .eq('student_id', profile.id)
        .order('due_date', { ascending: true });

      if (tasksError) throw tasksError;

      // Transform data to match our interface
      const transformedTasks: AssignedTask[] = (tasksData || []).map(task => {
        const now = new Date();
        const dueDate = new Date(task.due_date);
        const uploadDeadline = task.upload_deadline ? new Date(task.upload_deadline) : null;
        
        // Determine actual status based on proof uploads
        let currentStatus = task.status;
        const proofUploads = Array.isArray(task.proof_uploads) ? task.proof_uploads : [];
        
        if (proofUploads.length > 0) {
          // If proof is uploaded, status should be based on proof status
          const latestProof = proofUploads[proofUploads.length - 1];
          if (latestProof.status === 'Verified') {
            currentStatus = 'Completed';
          } else if (latestProof.status === 'Under Review') {
            currentStatus = 'Under Review';
          }
        } else if (task.started_at && uploadDeadline && now > uploadDeadline && task.status === 'In Progress') {
          // Check if task should revert to pending due to missed deadline
          currentStatus = 'Pending';
        }
        
        // Calculate relative time for due date
        const getRelativeTime = (date: Date) => {
          const diffMs = date.getTime() - now.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          
          if (diffDays < 0) {
            return `${Math.abs(diffDays)} days overdue`;
          } else if (diffDays === 0) {
            return 'Due today';
          } else if (diffDays === 1) {
            return 'Due tomorrow';
          } else {
            return `Due in ${diffDays} days`;
          }
        };
        
        return {
          id: task.id,
          title: task.title,
          deadline: getRelativeTime(dueDate),
          due_date: task.due_date, // Include raw date
          status: currentStatus as 'Pending' | 'In Progress' | 'Completed' | 'Under Review',
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
          can_start: !task.started_at && currentStatus === 'Pending',
          proof_submitted: proofUploads.length > 0
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
      case 'Under Review':
        return 75;
      case 'In Progress':
        return 50;
      default:
        return 0;
    }
  };

  const startTask = async (taskId: string) => {
    if (!user) throw new Error('User not authenticated');

    // Get student profile
    const { data: profile, error: profileError } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (profileError) throw profileError;
    if (!profile) throw new Error('Student profile not found');

    // Create or update task assignment (UPSERT logic to prevent duplicates)
    const { error: assignmentError } = await supabase
      .from('task_assignments')
      .upsert({
        task_id: taskId,
        student_id: profile.id,
        status: 'in_progress',
        assigned_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'task_id,student_id'
      });

    if (assignmentError) throw assignmentError;

    // Also update tasks table for backward compatibility
    const { error: taskError } = await supabase
      .from('tasks')
      .update({ 
        started_at: new Date().toISOString(),
        status: 'In Progress'
      })
      .eq('id', taskId);

    if (taskError) throw taskError;

    // Invalidate all related queries to refresh data
    queryClient.invalidateQueries({ queryKey: ['assigned-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['all-student-tasks'] });
  };

  return { 
    tasks: data || [], 
    loading, 
    error: error?.message || '', 
    startTask,
    refetch: query.refetch
  };
};
