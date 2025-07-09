
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Portfolio {
  id: string;
  student_id: string;
  public_url_slug: string;
  bio: string | null;
  skills: string[] | null;
  achievements: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

interface PortfolioWithProfile extends Portfolio {
  student_profiles: {
    full_name: string;
    email: string;
    profile_photo_url: string | null;
    total_xp: number;
    trust_score: number;
  };
  trust_scores: {
    score: number;
  } | null;
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

        let query = supabase
          .from('student_portfolios')
          .select(`
            *,
            student_profiles!inner(
              full_name,
              email,
              profile_photo_url,
              total_xp,
              trust_score
            ),
            trust_scores(score)
          `);

        if (slug) {
          // Public portfolio access by slug
          query = query.eq('public_url_slug', slug).eq('is_public', true);
        } else if (user) {
          // Current user's portfolio
          query = query.eq('student_profiles.user_id', user.id);
        } else {
          throw new Error('No user or slug provided');
        }

        const { data, error: fetchError } = await query.single();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            setError('Portfolio not found');
          } else {
            throw fetchError;
          }
          return;
        }

        setPortfolio(data);
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
