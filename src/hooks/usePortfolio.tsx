
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Portfolio {
  id: string;
  student_id: string;
  slug: string;
  bio: string | null;
  skills: string[] | null;
  achievements: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

interface PortfolioWithProfile extends Portfolio {
  student_profiles: {
    // No email. The portfolio page is public and the address is not.
    full_name: string;
    profile_photo_url: string | null;
    total_xp: number;
    trust_score: number;
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

        if (slug) {
          // Public portfolio access by slug
          const { data, error: fetchError } = await supabase
            .from('student_portfolios')
            .select(`
              *,
              student_profiles!inner(
                full_name,
                profile_photo_url,
                total_xp,
                trust_score
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

          setPortfolio(data as PortfolioWithProfile);
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
                total_xp,
                trust_score
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
                is_public: true,
              })
              .select(`
                *,
                student_profiles!inner(
                  full_name,
                  profile_photo_url,
                  total_xp,
                  trust_score
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
