import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
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

      // Check if student record already exists
      const { data: studentRecord } = await supabase
        .from('students')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (studentRecord) {
        // Student already onboarded, redirect to dashboard
        navigate('/student/dashboard', { replace: true });
        return;
      }

      // Create student record if it doesn't exist
      const { error } = await supabase.from('students').insert({
        user_id: user.id,
        name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Student',
        email: user.email || ''
      });

      if (error && !error.message.includes('duplicate')) {
        console.error('Error creating student record:', error);
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