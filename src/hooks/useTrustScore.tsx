
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface TrustScoreData {
  id: string;
  score: number;
  last_updated: string;
}

export const useTrustScore = () => {
  const [trustScore, setTrustScore] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const fetchTrustScore = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        // First get the student profile to get the student_id
        const { data: profile, error: profileError } = await supabase
          .from('student_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (profileError) {
          console.error('Error fetching student profile:', profileError);
          setError('Failed to fetch student profile');
          setLoading(false);
          return;
        }

        // Then fetch the trust score
        const { data: trustScoreData, error: trustScoreError } = await supabase
          .from('trust_scores')
          .select('score, last_updated')
          .eq('student_id', profile.id)
          .single();

        if (trustScoreError) {
          if (trustScoreError.code === 'PGRST116') {
            // No trust score found, default to 0
            setTrustScore(0);
          } else {
            console.error('Error fetching trust score:', trustScoreError);
            setError('Failed to fetch trust score');
          }
        } else {
          setTrustScore(trustScoreData.score);
        }
      } catch (err) {
        console.error('Error in fetchTrustScore:', err);
        setError('An unexpected error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchTrustScore();
  }, [user]);

  return { trustScore, loading, error };
};
