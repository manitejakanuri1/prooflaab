
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AssignedTask {
  id: string;
  title: string;
  deadline: string;
  status: 'Pending' | 'In Progress' | 'Completed';
  progress: number;
  description?: string;
  xp_reward?: number;
}

export const useAssignedTasks = () => {
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          setError("No authenticated user");
          setLoading(false);
          return;
        }

        // Get student profile to get student_id
        const { data: profile, error: profileError } = await supabase
          .from('student_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (profileError) {
          setError(profileError.message);
          setLoading(false);
          return;
        }

        console.log('Found student profile:', profile.id);

        // Fetch tasks for this student
        const { data: tasksData, error: tasksError } = await supabase
          .from('tasks')
          .select('*')
          .eq('student_id', profile.id)
          .order('due_date', { ascending: true });

        if (tasksError) {
          setError(tasksError.message);
          setLoading(false);
          return;
        }

        console.log('Found tasks:', tasksData);

        // Transform data to match our interface
        const transformedTasks: AssignedTask[] = (tasksData || []).map(task => ({
          id: task.id,
          title: task.title,
          deadline: new Date(task.due_date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          }),
          status: task.status as 'Pending' | 'In Progress' | 'Completed',
          progress: calculateProgress(task.status),
          description: task.description,
          xp_reward: task.xp_reward
        }));

        setTasks(transformedTasks);

      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, []);

  // Calculate progress based on status since we don't have a progress field in tasks table
  const calculateProgress = (status: string): number => {
    switch (status) {
      case 'Completed':
        return 100;
      case 'In Progress':
        return 50;
      default:
        return 0;
    }
  };

  return { tasks, loading, error };
};
