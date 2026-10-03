import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface StartupStats {
  totalTasks: number;
  totalSubmissions: number;
  verifiedProofs: number;
  pendingApplications: number;
}

export function useStartupStats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['startup-stats', user?.id],
    queryFn: async (): Promise<StartupStats> => {
      if (!user) {
        return {
          totalTasks: 0,
          totalSubmissions: 0,
          verifiedProofs: 0,
          pendingApplications: 0,
        };
      }

      // Get all task IDs created by this startup
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id')
        .eq('created_by_startup_id', user.id);

      const taskIds = tasks?.map(t => t.id) || [];

      // Get total tasks count
      const totalTasks = taskIds.length;

      // Submissions and accepted work: task_submissions via company_submissions()
      // (migration 54). Kept under the old field names so the overview is unchanged.
      const { data: subs } = await supabase.rpc("company_submissions" as never);
      const list = (subs as unknown as { source: string; review_decision: string | null }[]) ?? [];
      const totalSubmissions = list.length;
      const verifiedProofs = list.filter((x) => x.review_decision === "accepted").length;

      // Get pending applications for startup's tasks
      // Sponsored Lots count above even when no task was posted; applications only exist for posted tasks.
      const { count: pendingApplications } = taskIds.length === 0 ? { count: 0 } : await supabase
        .from('task_applications')
        .select('*', { count: 'exact', head: true })
        .in('task_id', taskIds)
        .eq('status', 'Pending Review');

      return {
        totalTasks: totalTasks || 0,
        totalSubmissions: totalSubmissions || 0,
        verifiedProofs: verifiedProofs || 0,
        pendingApplications: pendingApplications || 0,
      };
    },
    enabled: !!user,
  });
}

export type { StartupStats };