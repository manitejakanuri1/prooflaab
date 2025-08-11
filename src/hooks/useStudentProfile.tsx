
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface StudentProfile {
  id: string;
  full_name: string;
  email: string;
  profile_photo_url: string | null;
  total_xp: number;
  trust_score: number;
  slug: string | null;
}

interface LeaderboardEntry {
  id: string;
  rank: number;
}

export const useStudentProfile = () => {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [rank, setRank] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async () => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setError("No authenticated user");
        setLoading(false);
        return;
      }

      // Fetch student profile
      const { data: profileData, error: profileError } = await supabase
        .from('student_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }

      setProfile(profileData);

      // Fetch leaderboard rank using secure function
      const { data: leaderboardData, error: leaderboardError } = await supabase
        .rpc('get_leaderboard', { _limit: 1000 });

      if (leaderboardError) {
        console.warn("Could not fetch rank:", leaderboardError.message);
        setRank(0);
      } else if (leaderboardData) {
        const userRankData = leaderboardData.find(entry => entry.id === profileData.id);
        setRank(userRankData?.rank || 0);
      } else {
        setRank(0);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  // Function to refresh profile data
  const refreshProfile = () => {
    setLoading(true);
    fetchProfile();
  };

  return { profile, rank, loading, error, refreshProfile };
};
