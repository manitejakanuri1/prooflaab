
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ActivityLog {
  id: string;
  user_id: string;
  date: string;
  active_minutes: number;
  created_at: string;
  updated_at: string;
}

interface WeeklyActivity {
  date: string;
  dayName: string;
  active_minutes: number;
}

export const useActivityLogs = () => {
  const { user } = useAuth();
  const [weeklyData, setWeeklyData] = useState<WeeklyActivity[]>([]);
  const [totalWeeklyMinutes, setTotalWeeklyMinutes] = useState(0);
  const [todayMinutes, setTodayMinutes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getWeekDates = () => {
    const today = new Date();
    const currentDay = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (currentDay === 0 ? 6 : currentDay - 1));
    
    const weekDates = [];
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      weekDates.push({
        date: date.toISOString().split('T')[0],
        dayName: dayNames[i],
        active_minutes: 0
      });
    }
    
    return weekDates;
  };

  const fetchActivityLogs = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const weekDates = getWeekDates();
      const startDate = weekDates[0].date;
      const endDate = weekDates[6].date;

      console.log('Fetching activity logs for user:', user.id);
      console.log('Date range:', startDate, 'to', endDate);

      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('user_id', user.id)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) {
        console.error('Error fetching activity logs:', error);
        setError(error.message);
        return;
      }

      console.log('Fetched activity data:', data);

      // Create a map for quick lookup
      const activityMap = new Map<string, number>();
      data?.forEach((log: ActivityLog) => {
        activityMap.set(log.date, log.active_minutes);
      });

      // Fill in the week data with actual activity minutes
      const weeklyActivity = weekDates.map(day => ({
        ...day,
        active_minutes: activityMap.get(day.date) || 0
      }));

      setWeeklyData(weeklyActivity);
      
      const totalMinutes = weeklyActivity.reduce((sum, day) => sum + day.active_minutes, 0);
      setTotalWeeklyMinutes(totalMinutes);

      const today = new Date().toISOString().split('T')[0];
      const todayActivity = activityMap.get(today) || 0;
      setTodayMinutes(todayActivity);

    } catch (err) {
      console.error('Error in fetchActivityLogs:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivityLogs();
  }, [user]);

  const formatMinutesToHours = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) {
      return `${mins}m`;
    }
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const formatMinutesToDecimalHours = (minutes: number) => {
    return (minutes / 60).toFixed(1);
  };

  return {
    weeklyData,
    totalWeeklyMinutes,
    todayMinutes,
    loading,
    error,
    formatMinutesToHours,
    formatMinutesToDecimalHours
  };
};
