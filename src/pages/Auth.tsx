
import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import EnhancedRoleBasedAuthForm from "@/components/auth/EnhancedRoleBasedAuthForm";
import EmailVerificationPrompt from "@/components/auth/EmailVerificationPrompt";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Logo } from "@/components/Logo";
import { onboardingRoute } from "@/lib/onboardingRoute";

type UserRole = 'student' | 'college_admin' | 'startup' | 'admin' | 'recruiter';

export default function Auth() {
  const [showVerificationPrompt, setShowVerificationPrompt] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const navigate = useNavigate();

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
        // If session check fails or times out, clear it
        console.log('Session check failed or timed out');
        await supabase.auth.signOut().catch(() => {});
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

  if (showVerificationPrompt) {
    return (
      <div className="min-h-screen bg-background dark:bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-5">
          <Link to="/" className="inline-flex items-center justify-center space-x-2">
            <Logo className="h-12 w-12" />
            <span className="text-2xl font-bold text-foreground">ProofLabAI</span>
          </Link>
        </div>
          
          <EmailVerificationPrompt 
            email={userEmail}
            onVerified={() => setShowVerificationPrompt(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-5">
          <Link to="/" className="inline-flex items-center justify-center space-x-2">
            <Logo className="h-12 w-12" />
            <span className="text-2xl font-bold text-foreground">ProofLabAI</span>
          </Link>
        </div>

        {errorMessage && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        
        <EnhancedRoleBasedAuthForm onSuccess={handleAuthSuccess} />
        
        {/* No "clear session" or "sign out all users" here any more. They were
            a development escape hatch from stuck sessions, and read to a visitor
            as either broken or alarming - "sign out all users" sounds like it
            affects their whole college. The recovery they offered is automatic:
            a session that fails or takes over three seconds to check is signed
            out above, and signing in wipes any leftover state first. */}
      </div>
    </div>
  );
}
