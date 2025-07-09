
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useMonthlyXP = () => {
  const [monthlyXP, setMonthlyXP] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const fetchMonthlyXP = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        // Get the current month start and end dates
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        console.log('Fetching XP for month:', monthStart.toISOString(), 'to', monthEnd.toISOString());

        // First get the student profile id
        const { data: profileData, error: profileError } = await supabase
          .from('student_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (profileError) {
          console.error('Error fetching profile:', profileError);
          setError(profileError.message);
          setLoading(false);
          return;
        }

        console.log('Found student profile:', profileData.id);

        // Fetch completed tasks for current month
        const { data: tasksData, error: tasksError } = await supabase
          .from('tasks')
          .select('xp, completed_at, title, status')
          .eq('student_id', profileData.id)
          .eq('status', 'Completed')
          .gte('completed_at', monthStart.toISOString())
          .lte('completed_at', monthEnd.toISOString())
          .not('completed_at', 'is', null);

        if (tasksError) {
          console.error('Error fetching tasks:', tasksError);
          setError(tasksError.message);
          setLoading(false);
          return;
        }

        console.log('Found completed tasks:', tasksData);

        // Calculate total XP from completed tasks
        const totalXP = tasksData?.reduce((sum, task) => sum + (task.xp || 0), 0) || 0;
        console.log('Total XP this month:', totalXP);
        setMonthlyXP(totalXP);

      } catch (err) {
        console.error('Error in fetchMonthlyXP:', err);
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchMonthlyXP();
  }, [user]);

  return { monthlyXP, loading, error };
};
