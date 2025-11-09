import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useVerificationSettings = (collegeId?: string) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['verification-settings', collegeId],
    queryFn: async () => {
      if (!collegeId) return null;
      
      const { data, error } = await supabase
        .from('verification_settings')
        .select('*')
        .eq('college_id', collegeId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!collegeId,
  });

  const updateSettings = useMutation({
    mutationFn: async (newSettings: {
      college_id: string;
      min_trust_score: number;
      min_conceptual_score: number;
      min_ai_likelihood: number;
      min_authenticity_score: number;
      auto_approve_threshold: number;
    }) => {
      const { data, error } = await supabase
        .from('verification_settings')
        .upsert(newSettings, { onConflict: 'college_id' })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verification-settings'] });
      toast({
        title: "Settings Updated",
        description: "Verification thresholds have been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    settings,
    isLoading,
    updateSettings,
  };
};
