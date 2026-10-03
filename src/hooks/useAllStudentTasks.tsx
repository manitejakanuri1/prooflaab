import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tidyTitle } from "@/lib/utils";

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
  can_start?: boolean;
  // stage69/70: which grading mode this task uses, if any.
  sandbox_config_id?: string | null;
  rubric_config_id?: string | null;
  is_sandbox_task?: boolean;
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

      // Get assigned tasks from task_assignments table (supports multiple students per task)
      const { data: assignments, error: assignmentsError } = await supabase
        .from('task_assignments')
        .select(`
          task_id,
          status,
          tasks:task_id (
            id,
            title,
            description,
            due_date,
            xp_reward,
            status,
            started_at,
            created_by_type,
            created_by_startup_id,
            created_by_college_id,
            created_by_admin_id,
            sandbox_config_id,
            rubric_config_id,
            is_sandbox_task
          )
        `)
        .eq('student_id', profile.id)
        .order('assigned_at', { ascending: false });

      if (assignmentsError) throw assignmentsError;

      // Also get tasks directly assigned via tasks.student_id (legacy/manual assignments)
      const { data: directTasks, error: directTasksError } = await supabase
        .from('tasks')
        .select(`
          id,
          title,
          description,
          due_date,
          xp_reward,
          status,
          started_at,
          created_by_type,
          created_by_startup_id,
          created_by_college_id,
          created_by_admin_id,
          sandbox_config_id,
          rubric_config_id,
          is_sandbox_task,
          lot_date,
          roadmap_scorecard_id,
          level_id
        `)
        .eq('student_id', profile.id)
        .order('created_at', { ascending: false });

      if (directTasksError) throw directTasksError;

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
      const addedTaskIds = new Set<string>();

      // Add directly assigned tasks (legacy/manual assignments via tasks.student_id)
      (directTasks || []).forEach(task => {
        let status: 'Applied' | 'In Progress' | 'Completed' | 'Under Review' = 'Applied';

        // stage69/70: record_task_submission sets tasks.status = 'completed' on a pass.
        if (task.sandbox_config_id || task.rubric_config_id) {
          if (task.status === 'completed') status = 'Completed';
          else if (task.started_at) status = 'In Progress';
        } else if (task.started_at) {
          status = 'In Progress'; // started, not passed yet
        }
        // Not started: stays 'Applied'

        // Where the task really came from. Everything used to fall back to
        // "Admin", so the student's own roadmap and today's Lot looked like
        // work an administrator had handed out.
        let taskSource = 'Task';
        if (task.lot_date) taskSource = "Daily Lot";
        else if (task.roadmap_scorecard_id) taskSource = 'From your test';
        else if (task.level_id) taskSource = 'Track proof';
        else if (task.created_by_startup_id) taskSource = 'Company';
        else if (task.created_by_college_id) taskSource = 'College';
        else if (task.created_by_admin_id) taskSource = 'Admin';

        allTasks.push({
          id: task.id,
          title: task.lot_date ? tidyTitle(task.title) : task.title,
          description: task.description,
          deadline: task.due_date,
          status,
          source: taskSource,
          created_by_type: task.created_by_type || taskSource.toLowerCase(),
          xp_reward: task.xp_reward,
          created_by_startup_id: task.created_by_startup_id,
          can_start: !task.started_at && status === 'Applied',
          sandbox_config_id: task.sandbox_config_id,
          rubric_config_id: task.rubric_config_id,
          is_sandbox_task: task.is_sandbox_task,
        });
        addedTaskIds.add(task.id);
      });

      // Add assigned tasks from task_assignments
      (assignments || []).forEach(assignment => {
        const task = assignment.tasks;
        if (!task || addedTaskIds.has(task.id)) return; // Skip if already added
        let status: 'Applied' | 'In Progress' | 'Completed' | 'Under Review' = 'Applied';

        // stage69/70: a college/admin task graded automatically completes
        // via task_assignments.status (record_task_submission's non-owner
        // branch), not tasks.status.
        if (task.sandbox_config_id || task.rubric_config_id) {
          if (assignment.status === 'completed') status = 'Completed';
          else if (task.started_at) status = 'In Progress';
        } else if (task.started_at) {
          status = 'In Progress'; // started, not passed yet
        }
        // Not started: stays 'Applied'

        // Determine source based on available data
        let taskSource = 'Admin';
        if (task.created_by_startup_id) {
          taskSource = 'Company';
        } else if (task.created_by_college_id) {
          taskSource = 'College';
        } else if (task.created_by_admin_id) {
          taskSource = 'Admin';
        }

        allTasks.push({
          id: task.id,
          title: task.title,
          description: task.description,
          deadline: task.due_date,
          status,
          source: taskSource,
          created_by_type: task.created_by_type || taskSource.toLowerCase(),
          xp_reward: task.xp_reward,
          created_by_startup_id: task.created_by_startup_id,
          can_start: !task.started_at && status === 'Applied',
          sandbox_config_id: task.sandbox_config_id,
          rubric_config_id: task.rubric_config_id,
          is_sandbox_task: task.is_sandbox_task,
        });
        addedTaskIds.add(task.id);
      });

      // Add applications (both pending and accepted)
      (applications || []).forEach(app => {
        if (app.tasks && !addedTaskIds.has(app.tasks.id)) {
          // Determine status based on application state
          let taskStatus: 'Applied' | 'In Progress' | 'Completed' | 'Under Review' = 'Applied';
          if (app.status === 'Pending Review') {
            taskStatus = 'Applied'; // Waiting for approval
          } else if (app.status === 'Accepted') {
            taskStatus = 'Applied'; // Accepted but not started yet
          }

          // Determine source for application tasks
          let taskSource = 'Admin';
          if (app.tasks.created_by_startup_id) {
            taskSource = 'Company';
          } else if (app.tasks.created_by_type === 'college' || app.tasks.created_by_type === 'college_admin') {
            taskSource = 'College';
          } else if (app.tasks.created_by_type === 'admin') {
            taskSource = 'Admin';
          }

          allTasks.push({
            id: app.tasks.id,
            title: app.tasks.title,
            description: app.tasks.description,
            deadline: app.tasks.due_date,
            status: taskStatus,
            source: taskSource,
            created_by_type: app.tasks.created_by_type || taskSource.toLowerCase(),
            xp_reward: app.tasks.xp_reward,
            created_by_startup_id: app.tasks.created_by_startup_id,
            application_status: app.status,
            application_id: app.id,
            can_start: app.status === 'Accepted', // Can only start if accepted
          });
        }
      });

      return allTasks;
    },
    enabled: !!user,
  });

  // Moving a task/assignment off 'Applied' is a privileged write on both
  // sides: protect_task_assignments guards task_assignments.status, and
  // tasks' own RLS only lets a student update a row they directly own
  // (tasks.student_id), which an admin/college-assigned task never is - it
  // is only ever linked via task_assignments. Both of those silently
  // no-op (still 200/204) for a plain client PATCH, so this goes through
  // start_task_assignment() instead, the one function allowed to move it.
  const startTask = async (taskId: string) => {
    if (!user?.id) throw new Error('User not authenticated');

    const { data, error } = await supabase.rpc('start_task_assignment' as never, { _task_id: taskId } as never);
    if (error) throw error;
    const result = data as { ok: boolean; reason?: string } | null;
    if (!result?.ok) throw new Error(result?.reason || 'Could not start task');

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