import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { startOfWeek, endOfWeek } from "date-fns";

export const useWeeklyWorkTime = () => {
  const [workTime, setWorkTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    const fetchWeeklyWorkTime = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const now = new Date();
        const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday start
        const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

        const { data, error } = await supabase
          .from('activity_logs')
          .select('active_minutes')
          .eq('user_id', user.id)
          .gte('date', weekStart.toISOString().split('T')[0])
          .lte('date', weekEnd.toISOString().split('T')[0]);

        if (error) throw error;

        const totalMinutes = data?.reduce((sum, log) => sum + log.active_minutes, 0) || 0;
        setWorkTime(totalMinutes);
      } catch (error) {
        console.error('Error fetching weekly work time:', error);
        setWorkTime(0);
      } finally {
        setLoading(false);
      }
    };

    fetchWeeklyWorkTime();
  }, [user]);

  const formatWorkTime = (minutes: number) => {
    if (minutes === 0) return "0 hours";
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (hours === 0) {
      return `${remainingMinutes} min`;
    } else if (remainingMinutes === 0) {
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    } else {
      return `${hours}.${Math.round((remainingMinutes / 60) * 10)} hours`;
    }
  };

  return { 
    workTime: formatWorkTime(workTime), 
    workTimeMinutes: workTime,
    loading 
  };
};