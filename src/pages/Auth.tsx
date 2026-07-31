
import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import EnhancedRoleBasedAuthForm from "@/components/auth/EnhancedRoleBasedAuthForm";
import EmailVerificationPrompt from "@/components/auth/EmailVerificationPrompt";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Logo } from "@/components/Logo";

type UserRole = 'student' | 'college_admin' | 'startup' | 'admin';

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
                  if (roleData.has_completed_wizard) {
                    redirectToDashboard(roleData.role);
                  } else {
                    // Redirect to role-specific onboarding
                    const role = roleData.role;
                    if (role === 'student') {
                      navigate('/onboarding/student', { replace: true });
                    } else if (role === 'college_admin') {
                      navigate('/onboarding/college', { replace: true });
                    } else if (role === 'startup') {
                      navigate('/onboarding/startup', { replace: true });
                    } else {
                      navigate('/onboarding-wizard', { replace: true });
                    }
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
        // Redirect to role-specific onboarding
        if (role === 'student') {
          navigate('/onboarding/student', { replace: true });
        } else if (role === 'college_admin') {
          navigate('/onboarding/college', { replace: true });
        } else if (role === 'startup') {
          navigate('/onboarding/startup', { replace: true });
        } else {
          navigate('/onboarding-wizard', { replace: true });
        }
      } else {
        redirectToDashboard(role);
      }
    } catch (error) {
      // If no record or error, go to role-specific onboarding
      if (role === 'student') {
        navigate('/onboarding/student', { replace: true });
      } else if (role === 'college_admin') {
        navigate('/onboarding/college', { replace: true });
      } else if (role === 'startup') {
        navigate('/onboarding/startup', { replace: true });
      } else {
        navigate('/onboarding-wizard', { replace: true });
      }
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
        
        {/* Clear Session Option */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => window.location.href = '/auth?clear=true'}
            className="text-sm text-muted-foreground hover:underline mr-4"
          >
            Clear session & start fresh
          </button>
        </div>
        
        {/* Emergency Sign Out */}
        <div className="mt-2 text-center">
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
