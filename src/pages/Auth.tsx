
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import SignIn from "@/components/auth/SignIn";
import { AccessShell, usePageTitle } from "@/components/auth/AccessShell";
import { onboardingRoute } from "@/lib/onboardingRoute";

type UserRole = 'student' | 'college_admin' | 'startup' | 'admin' | 'recruiter';

export default function Auth() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // MF-069: a signed-in visitor sees a loader, not the sign-in form, while their session is checked.
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();
  // The set-password page sends people here with a "password set" note.
  const stateMessage = (useLocation().state as { message?: string } | null)?.message;
  usePageTitle("Sign in to Prooflab");

  useEffect(() => {
    // Check URL for messages (e.g., from email confirmation)
    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get('message');
    if (message) {
      setErrorMessage(message);
    }

    // Check if user explicitly wants to sign up/login (clear sessions)
    const clearSession = urlParams.get('clear');
    if (clearSession === 'true') {
      supabase.auth.signOut();
      // Remove the clear parameter from URL
      window.history.replaceState({}, document.title, '/auth');
      setChecking(false);
      return;
    }

    // Only check for existing sessions if user isn't explicitly trying to auth
    const clearStaleSession = async () => {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Session check timeout')), 3000)
      );

      try {
        await Promise.race([
          (async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              // Check if this is a valid authenticated session
              const { data: { user } } = await supabase.auth.getUser();
              if (user && user.email_confirmed_at) {
                // Valid session - check wizard completion and redirect
                const { data: roleData } = await supabase
                  .from('user_roles')
                  .select('role, has_completed_wizard')
                  .eq('user_id', user.id)
                  .maybeSingle();
                
                if (roleData) {
                  if (roleData.role === 'student') {
                    // Students are gated by intake, not the wizard flag.
                    // /student/start forwards on if intake is already done.
                    navigate('/student/start', { replace: true });
                  } else if (roleData.has_completed_wizard) {
                    redirectToDashboard(roleData.role);
                  } else {
                    // Role-specific onboarding (admins have none: dashboard).
                    navigate(onboardingRoute(roleData.role), { replace: true });
                  }
                }
              }
            }
          })(),
          timeout
        ]);
      } catch (error) {
        // MF-048: a slow check is not a broken session - never sign anyone out for being slow.
        if (error instanceof Error && error.message === 'Session check timeout') return;
        // A session check that really failed: clear it.
        await supabase.auth.signOut().catch(() => {});
      } finally {
        setChecking(false);
      }
    };
    
    clearStaleSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        navigate('/company/dashboard', { replace: true });
        break;
      case 'recruiter':
        navigate('/company/dashboard', { replace: true });
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
        // See RoleBasedProtectedRoute: no role row is a real state, not an error.
        .maybeSingle();

      // Students are gated by intake (/student/start), never the wizard flag.
      // /student/start forwards to the dashboard by itself once intake is done.
      if (role === 'student') {
        navigate('/student/start', { replace: true });
        return;
      }

      if (roleData && !roleData.has_completed_wizard) {
        // Role-specific onboarding (admins have none: dashboard).
        navigate(onboardingRoute(role), { replace: true });
      } else {
        redirectToDashboard(role);
      }
    } catch (error) {
      // If no record or error, go to role-specific onboarding
      navigate(role === 'student' ? '/student/start' : onboardingRoute(role), { replace: true });
    }
  };

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen" aria-busy="true">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#51A6FB]"></div>
      </div>
    );
  }

  return (
    <AccessShell>
      <SignIn onSuccess={handleAuthSuccess} notice={errorMessage ?? stateMessage ?? ""} />
    </AccessShell>
  );
}
