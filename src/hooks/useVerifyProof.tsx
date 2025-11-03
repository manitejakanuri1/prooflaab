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
      queryClient.invalidateQueries({ queryKey: ['student-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['trust-scores'] });
      
      if (data && data.originality_score !== undefined) {
        toast({
          title: "Verification Complete",
          description: `MOSS: ${data.moss_score || 0}% | AI Originality: ${data.originality_score}% | Trust Change: ${data.trust_change > 0 ? '+' : ''}${data.trust_change}`,
        });
      } else {
        toast({
          title: "Verification Processing",
          description: "Verification completed but results are syncing. Please refresh to see updates.",
        });
      }
    },
    onError: (error: any) => {
      console.error('Error running verification:', error);
      toast({
        title: "Verification Failed",
        description: error.message || "Failed to run verification check. Please try again.",
        variant: "destructive",
      });
    },
  });
};
