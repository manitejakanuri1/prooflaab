
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
  branch: string | null;
  year_of_study: string | null;
  key_interests: string[] | null;
  preferred_skills: string[] | null;
  career_goals: string | null;
  profile_completed: boolean;
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
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Profile fetch timeout')), 5000)
    );

    try {
      await Promise.race([
        (async () => {
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
            // email, resume and social links moved to student_contact so that
            // one signed-in student cannot read another's. Your own row is
            // always readable, and it is flattened back onto the profile below
            // so the screens that show profile.email keep working.
            .select('*, student_contact (email, resume_url, linkedin_url, github_url)')
            .eq('user_id', user.id)
            // A student has no profile row between signing up and StudentStart
            // creating it. single() reported that gap as a 406, which this hook
            // then surfaced as an error on the dashboard.
            .maybeSingle();

          if (profileError) {
            setError(profileError.message);
            setLoading(false);
            return;
          }

          setProfile(
            (profileData
              ? {
                  ...profileData,
                  email: (profileData as any).student_contact?.email ?? '',
                  resume_url: (profileData as any).student_contact?.resume_url ?? null,
                  linkedin_url: (profileData as any).student_contact?.linkedin_url ?? null,
                  github_url: (profileData as any).student_contact?.github_url ?? null,
                }
              : profileData) as any,
          );

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
        })(),
        timeout
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile load timed out");
      console.error('Profile fetch error:', err);
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
