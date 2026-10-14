import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import CollegeMultiStepWizard from '@/components/onboarding/CollegeMultiStepWizard';
import { useAuth } from '@/contexts/AuthContext';

export default function OnboardingCollege() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      navigate('/auth', { replace: true });
      return;
    }

    // Check if user already has college record
    const checkCollegeRecord = async () => {
      const { data } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        // User already onboarded, redirect to dashboard
        navigate('/college/dashboard', { replace: true });
        return;
      }
    };

    checkCollegeRecord();
  }, [user, navigate]);

  const handleWizardComplete = () => {
    navigate('/college/dashboard', { replace: true });
  };

  if (!user) {
    return null;
  }

  return <CollegeMultiStepWizard onComplete={handleWizardComplete} />;
}