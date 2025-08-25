import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface ActivityItem {
  id: string;
  type: 'proof_submission' | 'task_start' | 'task_completion' | 'xp_earned';
  message: string;
  timestamp: string;
  color: string;
}

export const useRecentActivity = () => {
  const { user } = useAuth();

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['recent-activity', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // Get student profile first
      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) return [];

      const activities: ActivityItem[] = [];

      // Get recent proof submissions
      const { data: proofs } = await supabase
        .from('proof_uploads')
        .select(`
          id,
          submitted_at,
          status,
          tasks (title)
        `)
        .eq('student_id', profile.id)
        .order('submitted_at', { ascending: false })
        .limit(5);

      if (proofs) {
        proofs.forEach(proof => {
          if (proof.submitted_at && proof.tasks) {
            activities.push({
              id: `proof-${proof.id}`,
              type: 'proof_submission',
              message: `You submitted proof for '${proof.tasks.title}'`,
              timestamp: proof.submitted_at,
              color: 'bg-green-500'
            });
          }
        });
      }

      // Get recent task starts
      const { data: startedTasks } = await supabase
        .from('tasks')
        .select('id, title, started_at')
        .eq('student_id', profile.id)
        .not('started_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(5);

      if (startedTasks) {
        startedTasks.forEach(task => {
          if (task.started_at) {
            activities.push({
              id: `task-start-${task.id}`,
              type: 'task_start',
              message: `Started new task '${task.title}'`,
              timestamp: task.started_at,
              color: 'bg-blue-500'
            });
          }
        });
      }

      // Get recent XP earnings
      const { data: xpLogs } = await supabase
        .from('xp_logs')
        .select('id, xp_points, source, created_at')
        .eq('student_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (xpLogs) {
        xpLogs.forEach(log => {
          activities.push({
            id: `xp-${log.id}`,
            type: 'xp_earned',
            message: `Earned ${log.xp_points} XP${log.source ? ` for ${log.source}` : ''}`,
            timestamp: log.created_at,
            color: 'bg-orange-500'
          });
        });
      }

      // Sort all activities by timestamp and return top 10
      return activities
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);
    },
    enabled: !!user?.id,
  });

  return {
    activities,
    loading: isLoading
  };
};