import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ActivityItem {
  id: string;
  type: 'task_posted' | 'application_received' | 'submission_received' | 'proof_verified';
  title: string;
  description: string;
  timestamp: string;
  status: 'success' | 'info' | 'warning';
}

export function useStartupActivity() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['startup-activity', user?.id],
    queryFn: async (): Promise<ActivityItem[]> => {
      if (!user) return [];

      const activities: ActivityItem[] = [];

      // Get all task IDs created by this startup
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, created_at')
        .eq('created_by_startup_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      const taskIds = tasks?.map(t => t.id) || [];

      // Add recent tasks to activities
      tasks?.slice(0, 5).forEach(task => {
        activities.push({
          id: `task-${task.id}`,
          type: 'task_posted',
          title: 'New Task Posted',
          description: `Posted new task: "${task.title}"`,
          timestamp: task.created_at,
          status: 'info',
        });
      });

      if (taskIds.length === 0) {
        return activities;
      }

      // Get recent applications for these tasks
      const { data: recentApplications } = await supabase
        .from('task_applications')
        .select(`
          id,
          created_at,
          task_id,
          student_profiles:student_id (full_name)
        `)
        .in('task_id', taskIds)
        .order('created_at', { ascending: false })
        .limit(5);

      recentApplications?.forEach(app => {
        const task = tasks?.find(t => t.id === app.task_id);
        activities.push({
          id: `app-${app.id}`,
          type: 'application_received',
          title: 'New Application',
          description: `${app.student_profiles?.full_name || 'A student'} applied for "${task?.title || 'a task'}"`,
          timestamp: app.created_at,
          status: 'info',
        });
      });

      // Get recent submissions for these tasks
      const { data: recentSubmissions } = await supabase
        .from('proof_uploads')
        .select(`
          id,
          submitted_at,
          status,
          task_id,
          student_profiles:student_id (full_name)
        `)
        .in('task_id', taskIds)
        .order('submitted_at', { ascending: false })
        .limit(5);

      recentSubmissions?.forEach(submission => {
        const task = tasks?.find(t => t.id === submission.task_id);
        activities.push({
          id: `sub-${submission.id}`,
          type: submission.status === 'Verified' ? 'proof_verified' : 'submission_received',
          title: submission.status === 'Verified' ? 'Proof Verified' : 'New Submission',
          description: submission.status === 'Verified' 
            ? `Verified proof submission from ${submission.student_profiles?.full_name || 'student'}`
            : `New submission received for "${task?.title || 'a task'}"`,
          timestamp: submission.submitted_at,
          status: submission.status === 'Verified' ? 'success' : 'info',
        });
      });

      // Sort all activities by timestamp and return top 10
      return activities
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);
    },
    enabled: !!user,
  });
}

export type { ActivityItem };