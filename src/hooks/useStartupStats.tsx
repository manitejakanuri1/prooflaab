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
      
      if (taskIds.length === 0) {
        return {
          totalTasks: 0,
          totalSubmissions: 0,
          verifiedProofs: 0,
          pendingApplications: 0,
        };
      }

      // Get total tasks count
      const totalTasks = taskIds.length;

      // Get total submissions (proof uploads) for startup's tasks
      const { count: totalSubmissions } = await supabase
        .from('proof_uploads')
        .select('*', { count: 'exact', head: true })
        .in('task_id', taskIds);

      // Get verified proofs for startup's tasks
      const { count: verifiedProofs } = await supabase
        .from('proof_uploads')
        .select('*', { count: 'exact', head: true })
        .in('task_id', taskIds)
        .eq('status', 'Verified');

      // Get pending applications for startup's tasks
      const { count: pendingApplications } = await supabase
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