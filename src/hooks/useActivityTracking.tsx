import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useActivityTracking = () => {
  const { user } = useAuth();
  const startTimeRef = useRef<Date | null>(null);
  const lastActivityRef = useRef<Date>(new Date());
  const accumulatedTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!user) return;

    startTimeRef.current = new Date();
    lastActivityRef.current = new Date();

    const trackActivity = () => {
      lastActivityRef.current = new Date();
    };

    const saveActivityLog = async () => {
      if (!startTimeRef.current) return;

      const now = new Date();
      const sessionDuration = Math.floor((now.getTime() - startTimeRef.current.getTime()) / 1000 / 60); // minutes
      
      // Only save if user was active for more than 1 minute
      if (sessionDuration > 1) {
        const today = now.toISOString().split('T')[0];

        try {
          // Get existing activity for today
          const { data: existingLog } = await supabase
            .from('activity_logs')
            .select('active_minutes')
            .eq('user_id', user.id)
            .eq('date', today)
            .single();

          const newActiveMinutes = (existingLog?.active_minutes || 0) + sessionDuration;

          // Upsert activity log
          await supabase
            .from('activity_logs')
            .upsert({
              user_id: user.id,
              date: today,
              active_minutes: newActiveMinutes,
              updated_at: now.toISOString()
            }, {
              onConflict: 'user_id,date'
            });

        } catch (error) {
          console.error('Error saving activity log:', error);
        }
      }
    };

    // Track mouse movement, clicks, and key presses
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => {
      document.addEventListener(event, trackActivity, true);
    });

    // Save activity every 5 minutes and on page unload
    const saveInterval = setInterval(saveActivityLog, 5 * 60 * 1000); // 5 minutes
    window.addEventListener('beforeunload', saveActivityLog);

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, trackActivity, true);
      });
      clearInterval(saveInterval);
      window.removeEventListener('beforeunload', saveActivityLog);
      saveActivityLog(); // Save on cleanup
    };
  }, [user]);
};