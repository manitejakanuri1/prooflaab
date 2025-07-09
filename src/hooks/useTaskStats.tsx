
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface TaskStats {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  completionPercentage: number;
}

export const useTaskStats = () => {
  const [taskStats, setTaskStats] = useState<TaskStats>({
    totalTasks: 0,
    completedTasks: 0,
    inProgressTasks: 0,
    pendingTasks: 0,
    completionPercentage: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTaskStats = async () => {
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          setError("No authenticated user");
          setLoading(false);
          return;
        }

        // First get the student profile id
        const { data: profileData, error: profileError } = await supabase
          .from('student_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (profileError) {
          setError(profileError.message);
          setLoading(false);
          return;
        }

        console.log('Found student profile:', profileData.id);

        // Fetch all tasks for this student
        const { data: tasksData, error: tasksError } = await supabase
          .from('tasks')
          .select('id, status')
          .eq('student_id', profileData.id);

        if (tasksError) {
          console.error('Error fetching tasks:', tasksError);
          setError(tasksError.message);
          setLoading(false);
          return;
        }

        console.log('Found tasks:', tasksData);

        // Calculate statistics
        const totalTasks = tasksData?.length || 0;
        const completedTasks = tasksData?.filter(task => task.status === 'Completed').length || 0;
        const inProgressTasks = tasksData?.filter(task => task.status === 'In Progress').length || 0;
        const pendingTasks = tasksData?.filter(task => task.status === 'Pending').length || 0;
        const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        setTaskStats({
          totalTasks,
          completedTasks,
          inProgressTasks,
          pendingTasks,
          completionPercentage
        });

      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchTaskStats();
  }, []);

  return { taskStats, loading, error };
};
