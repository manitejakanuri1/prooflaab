
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchPublicPortfolio, type PublicWork } from "@/lib/publicPortfolio";

interface Portfolio {
  // id and student_id are absent on the signed-out read: a stranger is not told them.
  id?: string;
  student_id?: string;
  slug: string;
  bio: string | null;
  skills: string[] | null;
  achievements: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  // Present only on the signed-out read, which carries the passed Lots with it.
  work?: PublicWork[];
}

interface PortfolioWithProfile extends Portfolio {
  student_profiles: {
    // No email. The portfolio page is public and the address is not.
    full_name: string;
    profile_photo_url: string | null;
    total_xp: number;
  };
}

export const usePortfolio = (slug?: string) => {
  const [portfolio, setPortfolio] = useState<PortfolioWithProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        setLoading(true);
        setError(null);

        if (slug && !user) {
          // Signed out: the general database route needs a login, so a shared
          // link is read through the narrow public route instead.
          const shared = await fetchPublicPortfolio(slug);
          if (shared) setPortfolio(shared);
          else setError('Portfolio not found');
        } else if (slug) {
          // Signed in: read by slug as this person
          const { data, error: fetchError } = await supabase
            .from('student_portfolios')
            .select(`
              *,
              student_profiles!inner(
                full_name,
                profile_photo_url,
                total_xp
              )
            `)
            .eq('slug', slug)
            .eq('is_public', true)
            .maybeSingle();

          if (fetchError) {
            if (fetchError.code === 'PGRST116') {
              setError('Portfolio not found');
            } else {
              throw fetchError;
            }
            return;
          }

          // The database shows a profile only to its owner, their college and
          // admins. Anyone else signed in sees what a signed-out visitor sees.
          const shown = (data as PortfolioWithProfile | null) ?? await fetchPublicPortfolio(slug);
          if (shown) setPortfolio(shown);
          else setError('Portfolio not found');
        } else if (user) {
          // Current user's portfolio - first get student profile ID
          const { data: profileData, error: profileError } = await supabase
            .from('student_profiles')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

          if (profileError || !profileData) {
            console.error('Error fetching student profile:', profileError);
            setError('Student profile not found');
            setLoading(false);
            return;
          }

          // Now fetch portfolio with the student_id
          const { data, error: fetchError } = await supabase
            .from('student_portfolios')
            .select(`
              *,
              student_profiles!inner(
                full_name,
                profile_photo_url,
                total_xp
              )
            `)
            .eq('student_id', profileData.id)
            .maybeSingle();

          if (fetchError) {
            throw fetchError;
          }

          // If no portfolio exists, create one
          if (!data) {
            const { data: newPortfolio, error: insertError } = await supabase
              .from('student_portfolios')
              .insert({
                student_id: profileData.id,
                is_public: false,
              })
              .select(`
                *,
                student_profiles!inner(
                  full_name,
                  profile_photo_url,
                  total_xp
                )
              `)
              .single();

            if (insertError) {
              console.error('Error creating portfolio:', insertError);
              setError('Failed to create portfolio');
              return;
            }

            setPortfolio(newPortfolio as PortfolioWithProfile);
          } else {
            setPortfolio(data as PortfolioWithProfile);
          }
        } else {
          throw new Error('No user or slug provided');
        }
      } catch (err) {
        console.error('Error fetching portfolio:', err);
        setError(err instanceof Error ? err.message : 'Failed to load portfolio');
      } finally {
        setLoading(false);
      }
    };

    fetchPortfolio();
  }, [slug, user]);

  const updatePortfolioVisibility = async (isPublic: boolean) => {
    if (!portfolio) return;

    try {
      const { error } = await supabase
        .from('student_portfolios')
        .update({ is_public: isPublic, updated_at: new Date().toISOString() })
        .eq('id', portfolio.id);

      if (error) throw error;

      setPortfolio(prev => prev ? { ...prev, is_public: isPublic } : null);
    } catch (err) {
      console.error('Error updating portfolio visibility:', err);
      throw err;
    }
  };

  return {
    portfolio,
    loading,
    error,
    updatePortfolioVisibility
  };
};
