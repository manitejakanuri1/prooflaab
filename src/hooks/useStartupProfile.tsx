import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface StartupProfile {
  id: string;
  startup_name: string;
  domain_industry: string | null;
  talent_needs: string[] | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export function useStartupProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['startup-profile', user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from('startup_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    },
    enabled: !!user,
  });
}

export type { StartupProfile };