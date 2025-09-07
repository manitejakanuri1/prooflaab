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

      // Get recent tasks posted
      const { data: recentTasks } = await supabase
        .from('tasks')
        .select('id, title, created_at')
        .eq('created_by_startup_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      recentTasks?.forEach(task => {
        activities.push({
          id: `task-${task.id}`,
          type: 'task_posted',
          title: 'New Task Posted',
          description: `Posted new task: "${task.title}"`,
          timestamp: task.created_at,
          status: 'info',
        });
      });

      // Get recent applications
      const { data: recentApplications } = await supabase
        .from('task_applications')
        .select(`
          id,
          created_at,
          tasks!inner (title, created_by_startup_id),
          student_profiles (full_name)
        `)
        .eq('tasks.created_by_startup_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      recentApplications?.forEach(app => {
        activities.push({
          id: `app-${app.id}`,
          type: 'application_received',
          title: 'New Application',
          description: `${app.student_profiles?.full_name || 'A student'} applied for "${app.tasks?.title}"`,
          timestamp: app.created_at,
          status: 'info',
        });
      });

      // Get recent submissions
      const { data: recentSubmissions } = await supabase
        .from('proof_uploads')
        .select(`
          id,
          submitted_at,
          status,
          tasks!inner (title, created_by_startup_id),
          student_profiles (full_name)
        `)
        .eq('tasks.created_by_startup_id', user.id)
        .order('submitted_at', { ascending: false })
        .limit(5);

      recentSubmissions?.forEach(submission => {
        activities.push({
          id: `sub-${submission.id}`,
          type: submission.status === 'Verified' ? 'proof_verified' : 'submission_received',
          title: submission.status === 'Verified' ? 'Proof Verified' : 'New Submission',
          description: submission.status === 'Verified' 
            ? `Verified proof submission from ${submission.student_profiles?.full_name || 'student'}`
            : `New submission received for "${submission.tasks?.title}"`,
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