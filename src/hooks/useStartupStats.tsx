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

      // Get total tasks posted by startup
      const { count: totalTasks } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('created_by_startup_id', user.id);

      // Get total submissions (proof uploads) for startup's tasks
      const { count: totalSubmissions } = await supabase
        .from('proof_uploads')
        .select('task_id, tasks!inner(created_by_startup_id)', { count: 'exact', head: true })
        .eq('tasks.created_by_startup_id', user.id);

      // Get verified proofs for startup's tasks
      const { count: verifiedProofs } = await supabase
        .from('proof_uploads')
        .select('task_id, tasks!inner(created_by_startup_id)', { count: 'exact', head: true })
        .eq('tasks.created_by_startup_id', user.id)
        .eq('status', 'Verified');

      // Get pending applications for startup's tasks
      const { count: pendingApplications } = await supabase
        .from('task_applications')
        .select('task_id, tasks!inner(created_by_startup_id)', { count: 'exact', head: true })
        .eq('tasks.created_by_startup_id', user.id)
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