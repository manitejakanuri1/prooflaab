
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface LeaderboardEntry {
  id: string;
  full_name: string;
  total_xp: number;
  rank: number;
}

interface LeaderboardData {
  topStudents: LeaderboardEntry[];
  currentUserRank: number | null;
  currentUserXP: number | null;
  totalStudents: number;
  loading: boolean;
  error: string | null;
}

export const useLeaderboard = (): LeaderboardData => {
  const { user } = useAuth();
  const [topStudents, setTopStudents] = useState<LeaderboardEntry[]>([]);
  const [currentUserRank, setCurrentUserRank] = useState<number | null>(null);
  const [currentUserXP, setCurrentUserXP] = useState<number | null>(null);
  const [totalStudents, setTotalStudents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeaderboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch top 10 students from leaderboard view
        const { data: topStudentsData, error: topStudentsError } = await supabase
          .from('leaderboard')
          .select('*')
          .order('rank', { ascending: true })
          .limit(10);

        if (topStudentsError) {
          throw topStudentsError;
        }

        setTopStudents(topStudentsData || []);

        // Get total number of students
        const { count: totalStudentsCount, error: countError } = await supabase
          .from('student_profiles')
          .select('*', { count: 'exact', head: true });

        if (countError) {
          throw countError;
        }

        setTotalStudents(totalStudentsCount || 0);

        // Get current user's profile and rank
        if (user) {
          const { data: currentUserProfile, error: profileError } = await supabase
            .from('student_profiles')
            .select('id, total_xp')
            .eq('user_id', user.id)
            .single();

          if (profileError) {
            console.warn("Could not fetch current user profile:", profileError.message);
          } else {
            setCurrentUserXP(currentUserProfile.total_xp || 0);

            // Get current user's rank from leaderboard view
            const { data: currentUserRankData, error: rankError } = await supabase
              .from('leaderboard')
              .select('rank')
              .eq('id', currentUserProfile.id)
              .single();

            if (rankError) {
              console.warn("Could not fetch current user rank:", rankError.message);
            } else {
              setCurrentUserRank(currentUserRankData?.rank || null);
            }
          }
        }

      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
        console.error("Leaderboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboardData();
  }, [user]);

  return {
    topStudents,
    currentUserRank,
    currentUserXP,
    totalStudents,
    loading,
    error
  };
};
