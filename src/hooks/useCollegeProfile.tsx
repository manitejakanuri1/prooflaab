import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface CollegeProfile {
  id: string;
  name: string;
  email: string;
  college_name?: string;
  location?: string;
  student_strength?: number;
  branches_offered?: string[];
  profile_photo_url?: string;
  status: string;
  verification_status?: string;
}

export const useCollegeProfile = () => {
  const [profile, setProfile] = useState<CollegeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Not authenticated');
        return;
      }

      // Load basic college data
      const { data: collegeData, error: collegeError } = await supabase
        .from('colleges')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (collegeError) throw collegeError;

      if (!collegeData) {
        setError('College not found');
        return;
      }

      // Load extended college profile
      const { data: profileData, error: profileError } = await supabase
        .from('college_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError && profileError.code !== 'PGRST116') {
        throw profileError;
      }

      // Combine both datasets
      const combinedProfile: CollegeProfile = {
        id: collegeData.id,
        name: collegeData.name,
        email: collegeData.email,
        status: collegeData.status,
        verification_status: collegeData.verification_status,
        college_name: profileData?.college_name || collegeData.name,
        location: profileData?.location,
        student_strength: profileData?.student_strength,
        branches_offered: profileData?.branches_offered,
        profile_photo_url: profileData?.profile_photo_url || null,
      };

      setProfile(combinedProfile);
    } catch (err) {
      console.error('Error loading college profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  return {
    profile,
    loading,
    error,
    refetch: loadProfile
  };
};