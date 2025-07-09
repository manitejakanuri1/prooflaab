
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

        // Fetch XP logs for current month
        const { data: xpData, error: xpError } = await supabase
          .from('xp_logs')
          .select('xp_points')
          .eq('student_id', profileData.id)
          .gte('created_at', monthStart.toISOString())
          .lte('created_at', monthEnd.toISOString());

        if (xpError) {
          console.error('Error fetching XP logs:', xpError);
          setError(xpError.message);
          setLoading(false);
          return;
        }

        // Calculate total XP for the month
        const totalXP = xpData?.reduce((sum, log) => sum + log.xp_points, 0) || 0;
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
