import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { ensureStudentProfile } from '@/lib/ensureStudentProfile';
import { toast } from 'sonner';

export default function OnboardingStudent() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const handleStudentOnboarding = async () => {
      if (!user) {
        navigate('/auth', { replace: true });
        return;
      }

      // This page used to read and write `students`, a second table that
      // duplicated name/email and that nothing else in the app ever read.
      // student_profiles is the real record.
      const { data: existingProfile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingProfile) {
        // Already onboarded, redirect to dashboard
        navigate('/student/dashboard', { replace: true });
        return;
      }

      await ensureStudentProfile(user);

      const { data: created } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!created) {
        toast.error('Failed to set up student profile');
        return;
      }

      toast.success('Welcome to ProofLabAI! 🎓');
      navigate('/student/dashboard', { replace: true });
    };

    handleStudentOnboarding();
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Setting up your account...</h2>
        <p className="text-gray-600">Please wait while we prepare your student dashboard.</p>
      </div>
    </div>
  );
}