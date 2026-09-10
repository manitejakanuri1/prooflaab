import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
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

const PROFILE_KEY = ["student-profile"] as const;
const RANK_KEY = ["student-rank"] as const;

/**
 * One cached, de-duplicated profile for the whole student app.
 *
 * Thirteen components call this hook. It used to fetch independently in each
 * of them - auth.getUser(), the profile row, and get_leaderboard(1000) - so the
 * landing screen alone ran that three times, and every tab click remounted a
 * component and ran it again. That was the click lag. React Query shares one
 * request and one cache across every caller; the return shape is unchanged.
 */
async function fetchProfile(): Promise<StudentProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No authenticated user");

  const { data, error } = await supabase
    .from("student_profiles")
    // email, resume and social links moved to student_contact so that one
    // signed-in student cannot read another's. Your own row is always
    // readable, and it is flattened back onto the profile below.
    .select("*, student_contact (email, resume_url, linkedin_url, github_url)")
    .eq("user_id", user.id)
    // A student has no profile row between signing up and StudentStart
    // creating it; maybeSingle reports that as null rather than a 406.
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const contact = (data as any).student_contact;
  return {
    ...data,
    email: contact?.email ?? "",
    resume_url: contact?.resume_url ?? null,
    linkedin_url: contact?.linkedin_url ?? null,
    github_url: contact?.github_url ?? null,
  } as any;
}

// The cache is keyed without a user id, so it must be dropped when the signed-in
// user changes - otherwise a sign-out and sign-in as someone else in the same
// tab would briefly show the previous person's profile. One listener, attached
// once for the app, compares user ids so a token refresh does not clear it.
let authListenerAttached = false;
let lastUserId: string | null | undefined;

function attachAuthListener(queryClient: QueryClient) {
  if (authListenerAttached) return;
  authListenerAttached = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id ?? null;
    if (lastUserId !== undefined && uid !== lastUserId) {
      queryClient.removeQueries({ queryKey: PROFILE_KEY });
      queryClient.removeQueries({ queryKey: RANK_KEY });
    }
    lastUserId = uid;
  });
}

export const useStudentProfile = () => {
  const queryClient = useQueryClient();
  attachAuthListener(queryClient);

  const profileQuery = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: fetchProfile,
  });
  const profile = profileQuery.data ?? null;

  // Separate query so the profile paints without waiting on a 1000-row
  // leaderboard, and so rank is cached longer than the profile - it moves
  // weekly, not per click.
  // ponytail: fetches up to 1000 rows to find one rank; a rank-for-student RPC if cohorts outgrow it.
  const rankQuery = useQuery({
    queryKey: [...RANK_KEY, profile?.id],
    enabled: !!profile?.id,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_leaderboard", { _limit: 1000 });
      if (error) {
        console.warn("Could not fetch rank:", error.message);
        return 0;
      }
      return data?.find((entry) => entry.id === profile!.id)?.rank || 0;
    },
  });

  const refreshProfile = () => {
    void queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
    void queryClient.invalidateQueries({ queryKey: RANK_KEY });
  };

  return {
    profile,
    rank: rankQuery.data ?? 0,
    loading: profileQuery.isLoading,
    error: profileQuery.error ? (profileQuery.error as Error).message : null,
    refreshProfile,
  };
};
