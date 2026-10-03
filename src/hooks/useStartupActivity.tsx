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

      // Recent submissions on this company's tasks (task_submissions, migration 54).
      const { data: subs } = await supabase.rpc("company_submissions" as never);
      const recent = ((subs as unknown as {
        submission_id: string; task_title: string; student_name: string;
        submitted_at: string; review_decision: string | null;
      }[]) ?? []).slice(0, 5);
      recent.forEach((s) => {
        const accepted = s.review_decision === "accepted";
        activities.push({
          id: `sub-${s.submission_id}`,
          type: accepted ? 'proof_verified' : 'submission_received',
          title: accepted ? 'Work Accepted' : 'New Submission',
          description: accepted
            ? `You accepted ${s.student_name || 'a student'}'s work on "${s.task_title}"`
            : `${s.student_name || 'A student'} submitted "${s.task_title}"`,
          timestamp: s.submitted_at,
          status: accepted ? 'success' : 'info',
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