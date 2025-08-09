import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface UserPreferences {
  email_notifications: boolean;
  push_notifications: boolean;
  task_reminders: boolean;
  weekly_digest: boolean;
  portfolio_public: boolean;
  show_progress_to_others: boolean;
  show_xp_rank: boolean;
  theme: 'light' | 'dark' | 'system';
  compact_mode: boolean;
}

const defaultPreferences: UserPreferences = {
  email_notifications: true,
  push_notifications: true,
  task_reminders: true,
  weekly_digest: false,
  portfolio_public: true,
  show_progress_to_others: false,
  show_xp_rank: true,
  theme: 'light',
  compact_mode: false,
};

export const useUserPreferences = () => {
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const fetchPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        console.error('Error fetching preferences:', error);
      } else if (data) {
        setPreferences({
          email_notifications: data.email_notifications,
          push_notifications: data.push_notifications,
          task_reminders: data.task_reminders,
          weekly_digest: data.weekly_digest,
          portfolio_public: data.portfolio_public,
          show_progress_to_others: data.show_progress_to_others,
          show_xp_rank: data.show_xp_rank,
          theme: data.theme as 'light' | 'dark' | 'system',
          compact_mode: data.compact_mode,
        });
      }
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const updatePreferences = async (newPreferences: Partial<UserPreferences>) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      const updatedPreferences = { ...preferences, ...newPreferences };

      const { error } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: user.id,
          ...updatedPreferences,
        });

      if (error) throw error;

      setPreferences(updatedPreferences);
      
      // Update portfolio visibility in student_portfolios if portfolio_public changed
      if (newPreferences.portfolio_public !== undefined) {
        const { data: profile } = await supabase
          .from('student_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (profile) {
          await supabase
            .from('student_portfolios')
            .upsert({
              student_id: profile.id,
              is_public: newPreferences.portfolio_public,
            });
        }
      }

      toast({
        title: "Settings updated",
        description: "Your preferences have been saved successfully.",
      });

      return true;
    } catch (error) {
      console.error('Error updating preferences:', error);
      toast({
        title: "Error updating settings",
        description: "Please try again later.",
        variant: "destructive",
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchPreferences();
  }, []);

  return {
    preferences,
    loading,
    saving,
    updatePreferences,
    refreshPreferences: fetchPreferences,
  };
};