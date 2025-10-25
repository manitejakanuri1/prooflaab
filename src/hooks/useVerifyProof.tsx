import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useVerifyProof = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (proofId: string) => {
      const { data, error } = await supabase.functions.invoke('verify-proof', {
        body: { proofId }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['proof-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['proof-submissions'] });
      
      toast({
        title: "Verification Complete",
        description: `MOSS: ${data.moss_score}% | AI Originality: ${data.originality_score}% | Trust Change: ${data.trust_change > 0 ? '+' : ''}${data.trust_change}`,
      });
    },
    onError: (error: any) => {
      console.error('Error running verification:', error);
      toast({
        title: "Verification Failed",
        description: error.message || "Failed to run verification check.",
        variant: "destructive",
      });
    },
  });
};
