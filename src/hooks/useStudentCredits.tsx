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
        .select('credits_available, credits_used_today, last_refreshed_at, premium_status, id, student_id')
        .eq('student_id', studentId)
        .maybeSingle();

      // If no record exists, create default credits for new user
      if (!data) {
        const { data: newCredits, error: insertError } = await supabase
          .from('student_credits')
          .insert({
            student_id: studentId,
            credits_available: 10,
            credits_used_today: 0,
            last_refreshed_at: new Date().toISOString(),
            premium_status: false
          })
          .select('credits_available, credits_used_today, last_refreshed_at, premium_status, id, student_id')
          .single();

        if (insertError) throw insertError;
        setCredits(newCredits);
        setLoading(false);
        return;
      }

      if (error) throw error;

      // Check if daily reset is needed (timezone-safe)
      const lastRefreshedDate = new Date(data.last_refreshed_at).toDateString();
      const currentDate = new Date().toDateString();

      if (lastRefreshedDate !== currentDate) {
        // Reset credits for new day
        const { data: resetData, error: resetError } = await supabase
          .from('student_credits')
          .update({
            credits_available: data.premium_status ? 999 : 10,
            credits_used_today: 0,
            last_refreshed_at: new Date().toISOString()
          })
          .eq('student_id', studentId)
          .select('credits_available, credits_used_today, last_refreshed_at, premium_status, id, student_id')
          .single();

        if (resetError) throw resetError;
        setCredits(resetData);
      } else {
        setCredits(data);
      }
    } catch (error) {
      console.error('Error fetching credits:', error);
      toast({
        title: "Error",
        description: "Failed to load credits. Please refresh the page.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const deductCredits = async (amount: number = 10): Promise<boolean> => {
    if (!studentId) {
      toast({
        title: "Error",
        description: "Student ID not found. Please refresh the page.",
        variant: "destructive",
      });
      return false;
    }

    try {
      // Fetch FRESH credits from database to avoid stale data
      const { data: freshCredits, error: fetchError } = await supabase
        .from('student_credits')
        .select('credits_available, credits_used_today, last_refreshed_at, premium_status, id, student_id')
        .eq('student_id', studentId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      // If no credits record exists, create one
      if (!freshCredits) {
        const { data: newCredits, error: insertError } = await supabase
          .from('student_credits')
          .insert({
            student_id: studentId,
            credits_available: 10,
            credits_used_today: 0,
            last_refreshed_at: new Date().toISOString(),
            premium_status: false
          })
          .select('credits_available, credits_used_today, last_refreshed_at, premium_status, id, student_id')
          .single();

        if (insertError) throw insertError;
        
        // Validate credits before deduction
        if (newCredits.credits_available < amount) {
          setCredits(newCredits);
          toast({
            title: "Insufficient Credits",
            description: "You've used all your daily credits. Wait until tomorrow or get extra credits.",
            variant: "destructive",
          });
          return false;
        }

        // Deduct credits for new user
        const { data: updatedCredits, error: updateError } = await supabase
          .from('student_credits')
          .update({
            credits_available: newCredits.credits_available - amount,
            credits_used_today: amount,
          })
          .eq('student_id', studentId)
          .select('credits_available, credits_used_today, last_refreshed_at, premium_status, id, student_id')
          .single();

        if (updateError) throw updateError;
        setCredits(updatedCredits);
        return true;
      } else {
        // Check if daily reset is needed
        const lastRefreshedDate = new Date(freshCredits.last_refreshed_at).toDateString();
        const currentDate = new Date().toDateString();

        if (lastRefreshedDate !== currentDate) {
          // Reset credits for new day
          const resetCredits = freshCredits.premium_status ? 999 : 10;
          const { data: resetData, error: resetError } = await supabase
            .from('student_credits')
            .update({
              credits_available: resetCredits,
              credits_used_today: 0,
              last_refreshed_at: new Date().toISOString()
            })
            .eq('student_id', studentId)
            .select('credits_available, credits_used_today, last_refreshed_at, premium_status, id, student_id')
            .single();

          if (resetError) throw resetError;
          
          // Update with reset data
          if (resetData.credits_available < amount) {
            setCredits(resetData);
            toast({
              title: "Insufficient Credits",
              description: "You've used all your daily credits. Wait until tomorrow or get extra credits.",
              variant: "destructive",
            });
            return false;
          }
          
          // Deduct from reset credits
          const { data: updatedCredits, error: updateError } = await supabase
            .from('student_credits')
            .update({
              credits_available: resetData.credits_available - amount,
              credits_used_today: amount,
            })
            .eq('student_id', studentId)
            .select('credits_available, credits_used_today, last_refreshed_at, premium_status, id, student_id')
            .single();

          if (updateError) throw updateError;
          setCredits(updatedCredits);
          return true;
        }

        // No reset needed, validate fresh credits
        if (freshCredits.credits_available < amount) {
          setCredits(freshCredits);
          toast({
            title: "Insufficient Credits",
            description: "You've used all your daily credits. Wait until tomorrow or get extra credits.",
            variant: "destructive",
          });
          return false;
        }

        // Deduct credits after validation passes
        const { data: updatedCredits, error: updateError } = await supabase
          .from('student_credits')
          .update({
            credits_available: freshCredits.credits_available - amount,
            credits_used_today: freshCredits.credits_used_today + amount,
          })
          .eq('student_id', studentId)
          .select('credits_available, credits_used_today, last_refreshed_at, premium_status, id, student_id')
          .single();

        if (updateError) throw updateError;
        setCredits(updatedCredits);
        return true;
      }

    } catch (error) {
      console.error('Error deducting credits:', error);
      toast({
        title: "Error",
        description: "Failed to process credits. Please try again.",
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