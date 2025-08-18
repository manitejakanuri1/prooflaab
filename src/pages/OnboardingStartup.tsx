import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import InviteCodeVerificationForm from '@/components/auth/InviteCodeVerificationForm';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function OnboardingStartup() {
  const [isModalOpen, setIsModalOpen] = useState(true);
  const [userEmail, setUserEmail] = useState('');
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

    setUserEmail(user.email || '');
    checkStartupRecord();
  }, [user, navigate]);

  const handleInviteCodeSuccess = async () => {
    setIsModalOpen(false);
    toast.success('Welcome to ProofLabAI! 🚀');
    navigate('/startup/dashboard', { replace: true });
  };

  const handleModalClose = () => {
    // Don't allow closing the modal - user must verify invite code
    return;
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-pink-50 flex items-center justify-center p-4">
      <div className="text-center max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Welcome to ProofLabAI Startup Portal! 🚀
          </h1>
          <p className="text-lg text-gray-600">
            You're just one step away from accessing your Startup dashboard.
            Please verify your invite code to continue.
          </p>
        </div>
        
        <div className="bg-white/50 backdrop-blur-sm rounded-lg p-8 border border-white/20">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Setting up your Startup Account
          </h2>
          <p className="text-gray-600">
            As a Startup Admin, you'll be able to:
          </p>
          <ul className="text-left mt-4 space-y-2 text-gray-700">
            <li>• Post real-world tasks for students</li>
            <li>• Review student applications and select candidates</li>
            <li>• Verify proof submissions and award XP</li>
            <li>• Access a pipeline of talented students</li>
          </ul>
        </div>
      </div>

      <Dialog open={isModalOpen} onOpenChange={handleModalClose}>
        <DialogContent className="max-w-md" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-center">Complete Your Setup</DialogTitle>
          </DialogHeader>
          <InviteCodeVerificationForm
            email={userEmail}
            accountType="startup"
            onSuccess={handleInviteCodeSuccess}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}