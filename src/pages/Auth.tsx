
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import EnhancedRoleBasedAuthForm from "@/components/auth/EnhancedRoleBasedAuthForm";
import EmailVerificationPrompt from "@/components/auth/EmailVerificationPrompt";

type UserRole = 'student' | 'college_admin' | 'startup' | 'admin';

export default function Auth() {
  const [showVerificationPrompt, setShowVerificationPrompt] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is already logged in
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Get user role and redirect accordingly
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .single();
        
        const role = roleData?.role || 'student';
        redirectToDashboard(role);
      }
    };
    checkUser();
  }, [navigate]);

  const redirectToDashboard = (role: UserRole) => {
    switch (role) {
      case 'admin':
        navigate('/admin/dashboard', { replace: true });
        break;
      case 'college_admin':
        navigate('/college/dashboard', { replace: true });
        break;
      case 'startup':
        navigate('/startup/dashboard', { replace: true });
        break;
      case 'student':
      default:
        navigate('/student/dashboard', { replace: true });
        break;
    }
  };

  const handleAuthSuccess = async (role: UserRole) => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check if wizard needs to be completed
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('has_completed_wizard')
        .eq('user_id', user.id)
        .single();

      if (roleData && !roleData.has_completed_wizard) {
        navigate('/onboarding-wizard', { replace: true });
      } else {
        redirectToDashboard(role);
      }
    } catch (error) {
      // If no record or error, go to wizard
      navigate('/onboarding-wizard', { replace: true });
    }
  };

  const handleSignOutAll = async () => {
    // Clean up auth state
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('supabase.auth.') || key.includes('sb-')) {
        localStorage.removeItem(key);
      }
    });
    
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch (err) {
      // Continue even if this fails
    }
    
    window.location.reload();
  };

  if (showVerificationPrompt) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center p-4">
        <EmailVerificationPrompt 
          email={userEmail}
          onVerified={() => setShowVerificationPrompt(false)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <EnhancedRoleBasedAuthForm onSuccess={handleAuthSuccess} />
        
        {/* Emergency Sign Out */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleSignOutAll}
            className="text-sm text-destructive hover:underline"
          >
            Sign out all users
          </button>
        </div>
      </div>
    </div>
  );
}
