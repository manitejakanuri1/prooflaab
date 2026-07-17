import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface StartupTask {
  id: string;
  title: string;
  description?: string;
  deadline: string;
  status: string;
  created_at: string;
  applicant_count?: number;
}

export function useStartupTasks() {
  const [tasks, setTasks] = useState<StartupTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setError("User not authenticated");
        return;
      }

      const { data, error } = await supabase
        .from("tasks")
        .select(`
          id,
          title,
          description,
          due_date,
          status,
          created_at,
          task_applications(count)
        `)
        .eq("created_by_startup_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        setError(error.message);
      } else {
        // Transform the data to match our interface
        const transformedTasks = data?.map(task => ({
          id: task.id,
          title: task.title,
          description: task.description,
          deadline: task.due_date,
          status: task.status || 'Pending',
          created_at: task.created_at,
          applicant_count: task.task_applications?.[0]?.count ?? 0
        })) || [];
        
        setTasks(transformedTasks);
      }
    } catch (err) {
      setError("Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  return {
    tasks,
    loading,
    error,
    refetch: fetchTasks
  };
}