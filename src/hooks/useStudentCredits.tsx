import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface StudentCredits {
  id: string;
  student_id: string;
  credits_available: number;
  credits_used_today: number;
  last_refreshed_at: string;
  premium_status: boolean;
}

export const useStudentCredits = (studentId: string | undefined) => {
  const [credits, setCredits] = useState<StudentCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchCredits = async () => {
    if (!studentId) return;

    try {
      const { data, error } = await supabase
        .from('student_credits')
        .select('*')
        .eq('student_id', studentId)
        .single();

      if (error) throw error;
      setCredits(data);
    } catch (error) {
      console.error('Error fetching credits:', error);
    } finally {
      setLoading(false);
    }
  };

  const deductCredits = async (amount: number = 10): Promise<boolean> => {
    if (!credits || !studentId) return false;

    if (credits.credits_available < amount) {
      toast({
        title: "Insufficient Credits",
        description: "You've used all your daily credits. Wait until tomorrow or get extra credits.",
        variant: "destructive",
      });
      return false;
    }

    try {
      const { error } = await supabase
        .from('student_credits')
        .update({
          credits_available: credits.credits_available - amount,
          credits_used_today: credits.credits_used_today + amount,
        })
        .eq('student_id', studentId);

      if (error) throw error;

      // Update local state
      setCredits({
        ...credits,
        credits_available: credits.credits_available - amount,
        credits_used_today: credits.credits_used_today + amount,
      });

      return true;
    } catch (error) {
      console.error('Error deducting credits:', error);
      toast({
        title: "Error",
        description: "Failed to deduct credits. Please try again.",
        variant: "destructive",
      });
      return false;
    }
  };

  useEffect(() => {
    fetchCredits();
  }, [studentId]);

  return { credits, loading, deductCredits, refreshCredits: fetchCredits };
};