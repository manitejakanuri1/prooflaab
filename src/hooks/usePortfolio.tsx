
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
    full_name: string;
    email: string;
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
            )
          `);

        if (slug) {
          // Public portfolio access by slug
          query = query.eq('slug', slug).eq('is_public', true);
        } else if (user) {
          // Current user's portfolio
          query = query.eq('student_profiles.user_id', user.id);
        } else {
          throw new Error('No user or slug provided');
        }

        const { data, error: fetchError } = await query.maybeSingle();

        if (fetchError) {
          if (fetchError.code === 'PGRST116') {
            setError('Portfolio not found');
          } else {
            throw fetchError;
          }
          return;
        }

        // If no portfolio exists and we have a user, create one
        if (!data && user && !slug) {
          await createPortfolioForUser();
          return;
        }

        // Transform the data to match our interface
        const portfolioData: PortfolioWithProfile = {
          ...data
        };

        setPortfolio(portfolioData);
      } catch (err) {
        console.error('Error fetching portfolio:', err);
        setError(err instanceof Error ? err.message : 'Failed to load portfolio');
      } finally {
        setLoading(false);
      }
    };

    const createPortfolioForUser = async () => {
      if (!user) return;

      try {
        // First get the student profile
        const { data: studentProfile, error: profileError } = await supabase
          .from('student_profiles')
          .select('id, slug, full_name')
          .eq('user_id', user.id)
          .maybeSingle();

        if (profileError) throw profileError;

        if (!studentProfile) {
          setError('Student profile not found. Please complete your profile first.');
          return;
        }

        // Create portfolio
        const { data: newPortfolio, error: createError } = await supabase
          .from('student_portfolios')
          .insert({
            student_id: studentProfile.id,
            slug: studentProfile.slug,
            is_public: true,
            bio: null,
            skills: null,
            achievements: null
          })
          .select(`
            *,
            student_profiles!inner(
              full_name,
              email,
              profile_photo_url,
              total_xp,
              trust_score
            )
          `)
          .single();

        if (createError) throw createError;

        setPortfolio(newPortfolio);
      } catch (err) {
        console.error('Error creating portfolio:', err);
        setError('Failed to create portfolio');
      }
    };

    fetchPortfolio();
  }, [slug, user]);

  const updatePortfolioVisibility = async (isPublic: boolean) => {
    if (!portfolio || !portfolio.id) {
      throw new Error('Portfolio not found');
    }

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

  const updatePortfolio = async (updates: { bio?: string; skills?: string[]; achievements?: string }) => {
    if (!portfolio || !portfolio.id) {
      throw new Error('Portfolio not found');
    }

    try {
      const { error } = await supabase
        .from('student_portfolios')
        .update({ 
          ...updates,
          updated_at: new Date().toISOString() 
        })
        .eq('id', portfolio.id);

      if (error) throw error;

      setPortfolio(prev => prev ? { ...prev, ...updates } : null);
    } catch (err) {
      console.error('Error updating portfolio:', err);
      throw err;
    }
  };

  return {
    portfolio,
    loading,
    error,
    updatePortfolioVisibility,
    updatePortfolio
  };
};
