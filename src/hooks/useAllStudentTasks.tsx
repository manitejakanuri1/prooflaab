import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface StudentTask {
  id: string;
  title: string;
  description: string | null;
  deadline: string;
  status: 'Applied' | 'In Progress' | 'Completed' | 'Under Review';
  source: string;
  created_by_type?: string;
  xp_reward: number | null;
  created_by_startup_id: string | null;
  application_status?: string;
  application_id?: string;
  proof_submitted?: boolean;
  can_start?: boolean;
}

export const useAllStudentTasks = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['all-student-tasks', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // Get student profile
      const { data: profile, error: profileError } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError || !profile) return [];

      // Get assigned tasks
      const { data: assignedTasks, error: assignedError } = await supabase
        .from('tasks')
        .select(`
          *,
          proof_uploads (id, status, submitted_at)
        `)
        .eq('student_id', profile.id)
        .order('created_at', { ascending: false });

      if (assignedError) throw assignedError;

      // Get task applications
      const { data: applications, error: appsError } = await supabase
        .from('task_applications')
        .select(`
          id,
          status,
          created_at,
          tasks (
            id,
            title,
            description,
            due_date,
            xp_reward,
            created_by_type,
            created_by_startup_id
          )
        `)
        .eq('student_id', profile.id)
        .order('created_at', { ascending: false });

      if (appsError) throw appsError;

      const allTasks: StudentTask[] = [];

      // Add assigned tasks
      (assignedTasks || []).forEach(task => {
        const proofUploads = Array.isArray(task.proof_uploads) ? task.proof_uploads : [];
        let status: 'Applied' | 'In Progress' | 'Completed' | 'Under Review' = 'In Progress';
        
        if (proofUploads.length > 0) {
          const latestProof = proofUploads[proofUploads.length - 1];
          if (latestProof.status === 'Verified') {
            status = 'Completed';
          } else if (latestProof.status === 'Under Review') {
            status = 'Under Review';
          }
        }
        // Don't override to 'Applied' if started_at is null - respect the task's actual status
        // Status is now 'In Progress' by default for assigned tasks

        allTasks.push({
          id: task.id,
          title: task.title,
          description: task.description,
          deadline: task.due_date,
          status,
          source: task.created_by_startup_id ? 'Startup' : (task.created_by_type || 'Admin'),
          created_by_type: task.created_by_type,
          xp_reward: task.xp_reward,
          created_by_startup_id: task.created_by_startup_id,
          proof_submitted: proofUploads.length > 0,
          can_start: false, // Assigned tasks are already started
        });
      });

      // Add applications (both pending and accepted)
      (applications || []).forEach(app => {
        if (app.tasks) {
          // Only show if task is not already assigned
          const isAlreadyAssigned = allTasks.some(t => t.id === app.tasks.id);
          if (!isAlreadyAssigned) {
            // Determine status based on application state
            let taskStatus: 'Applied' | 'In Progress' | 'Completed' | 'Under Review' = 'Applied';
            if (app.status === 'Pending Review') {
              taskStatus = 'Applied'; // Waiting for approval
            } else if (app.status === 'Accepted') {
              taskStatus = 'Applied'; // Accepted but not started yet
            }

            allTasks.push({
              id: app.tasks.id,
              title: app.tasks.title,
              description: app.tasks.description,
              deadline: app.tasks.due_date,
              status: taskStatus,
              source: app.tasks.created_by_startup_id ? 'Startup' : (app.tasks.created_by_type || 'Admin'),
              created_by_type: app.tasks.created_by_type,
              xp_reward: app.tasks.xp_reward,
              created_by_startup_id: app.tasks.created_by_startup_id,
              application_status: app.status,
              application_id: app.id,
              proof_submitted: false,
              can_start: app.status === 'Accepted', // Can only start if accepted
            });
          }
        }
      });

      return allTasks;
    },
    enabled: !!user,
  });

  const startTask = async (taskId: string) => {
    const { error } = await supabase
      .from('tasks')
      .update({ 
        started_at: new Date().toISOString()
      })
      .eq('id', taskId);

    if (error) throw error;

    // Invalidate queries to refresh data
    queryClient.invalidateQueries({ queryKey: ['all-student-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['assigned-tasks'] });
  };

  return {
    tasks: query.data || [],
    loading: query.isLoading,
    error: query.error?.message || '',
    startTask,
    refetch: query.refetch
  };
};