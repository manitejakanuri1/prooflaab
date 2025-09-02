import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import StartupMultiStepWizard from '@/components/onboarding/StartupMultiStepWizard';
import { useAuth } from '@/contexts/AuthContext';

export default function OnboardingStartup() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      navigate('/auth', { replace: true });
      return;
    }

    // Check if user already has startup record
    const checkStartupRecord = async () => {
      const { data } = await supabase
        .from('startups')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        // User already onboarded, redirect to dashboard
        navigate('/startup/dashboard', { replace: true });
        return;
      }
    };

    checkStartupRecord();
  }, [user, navigate]);

  const handleWizardComplete = () => {
    navigate('/startup/dashboard', { replace: true });
  };

  if (!user) {
    return null;
  }

  return <StartupMultiStepWizard onComplete={handleWizardComplete} />;
}