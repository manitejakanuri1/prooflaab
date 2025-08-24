import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleAuthCallback = async () => {
      console.log('AuthCallback: Starting auth callback handling');
      console.log('AuthCallback: Current URL:', window.location.href);
      console.log('AuthCallback: Search params:', Object.fromEntries(searchParams.entries()));
      
      try {
        // Handle the auth callback from email confirmation
        const { data: authData, error: authError } = await supabase.auth.getSession();
        
        if (authError) {
          console.error('AuthCallback: Initial auth error:', authError);
          throw authError;
        }

        console.log('AuthCallback: Initial session check:', authData);

        // If we already have a session, process it
        if (authData.session?.user) {
          console.log('AuthCallback: User session found, processing...');
          await handleSuccessfulAuth(authData.session);
          return;
        }

        // Check if this is an email confirmation callback by looking for hash params
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        console.log('AuthCallback: Hash params:', Object.fromEntries(hashParams.entries()));

        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (accessToken && refreshToken) {
          console.log('AuthCallback: Setting session with tokens from hash');
          
          // Set the session using access token and refresh token
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionError) {
            console.error('AuthCallback: Error setting session:', sessionError);
            throw sessionError;
          }

          if (sessionData.session?.user) {
            console.log('AuthCallback: Session successfully restored');
            await handleSuccessfulAuth(sessionData.session);
            return;
          }
        } else if (hashParams.get('access_token')) {
          console.log('AuthCallback: Access token found but no refresh token, trying alternative approach...');
          // Wait a bit for Supabase to process the hash params automatically
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Check session again
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          
          if (sessionError) {
            console.error('AuthCallback: Session error after hash processing:', sessionError);
            throw sessionError;
          }

          if (sessionData.session?.user) {
            console.log('AuthCallback: User session found after processing hash');
            await handleSuccessfulAuth(sessionData.session);
            return;
          }
        }

        // If no session and no hash params, this might be a stale callback
        console.log('AuthCallback: No session or hash params found, redirecting to auth');
        navigate('/auth?message=Please sign in to continue.', { replace: true });

      } catch (error: any) {
        console.error('Auth callback error:', error);
        
        // Handle specific error cases
        if (error.message?.includes('Email link is invalid') || error.message?.includes('expired')) {
          setError('This email confirmation link has expired or is invalid. Please request a new one.');
        } else if (error.message?.includes('already confirmed')) {
          navigate('/auth?message=Email already confirmed! Please log in.', { replace: true });
          return;
        } else {
          setError(error.message || 'Authentication failed. Please try again.');
        }
        setLoading(false);
      }
    };

    const handleSuccessfulAuth = async (session: any) => {
      const user = session.user;
      const accountType = searchParams.get('type') || user.user_metadata?.account_type;
      
      console.log('AuthCallback: User:', user);
      console.log('AuthCallback: Account type:', accountType);
      console.log('AuthCallback: Email confirmed:', user.email_confirmed_at);

      // Email should be confirmed at this point since we're in the callback
      if (!user.email_confirmed_at) {
        console.log('Email not confirmed after callback, this is unusual');
        navigate('/auth?message=Please confirm your email address to continue', { replace: true });
        return;
      }

      // Get existing role and wizard completion status
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role, has_completed_wizard')
        .eq('user_id', user.id)
        .maybeSingle();

      if (roleError) {
        console.error('Error fetching user role:', roleError);
      }

      const currentRole = roleData?.role;
      const hasCompletedWizard = roleData?.has_completed_wizard;

      // If role exists, check wizard completion first
      if (currentRole) {
        console.log('Existing role found:', currentRole);
        console.log('Wizard completed:', hasCompletedWizard);
        
        // If wizard not completed, redirect to onboarding wizard
        if (!hasCompletedWizard) {
          navigate('/onboarding-wizard', { replace: true });
          return;
        }
        
        // Wizard completed, redirect to appropriate dashboard
        switch (currentRole) {
          case 'admin':
            navigate('/admin/dashboard', { replace: true });
            break;
          case 'college_admin':
            // Check if college record exists and status
            const { data: collegeRecord } = await supabase
              .from('colleges')
              .select('id, status')
              .eq('user_id', user.id)
              .maybeSingle();

            if (!collegeRecord || collegeRecord.status === 'pending') {
              navigate('/onboarding/college', { replace: true });
            } else {
              navigate('/college/dashboard', { replace: true });
            }
            break;
          case 'startup':
            // Check if startup record exists and status
            const { data: startupRecord } = await supabase
              .from('startups')
              .select('id, status')
              .eq('user_id', user.id)
              .maybeSingle();

            if (!startupRecord || startupRecord.status === 'pending') {
              navigate('/onboarding/startup', { replace: true });
            } else {
              navigate('/startup/dashboard', { replace: true });
            }
            break;
          case 'student':
          default:
            navigate('/student/dashboard', { replace: true });
            break;
        }
        return;
      }

      // No existing role - create one based on account type from user metadata
      console.log('No existing role found, creating role based on account type:', accountType);
      
      const roleToCreate = accountType || 'student';
      
      try {
        // Create role
        const { error: roleInsertError } = await supabase
          .from('user_roles')
          .insert({ user_id: user.id, role: roleToCreate });
        
        if (roleInsertError) {
          console.error('Error creating role:', roleInsertError);
          // Still continue with navigation even if role creation fails
        }

        // Create appropriate profile record and redirect to wizard
        if (roleToCreate === 'student') {
          await supabase.from('students').insert({
            user_id: user.id,
            name: user.user_metadata?.full_name || '',
            email: user.email || ''
          });
        } else if (roleToCreate === 'college_admin') {
          // College record will be created in onboarding
        } else if (roleToCreate === 'startup') {
          // Startup record will be created in onboarding
        }
        
        // All new users go to onboarding wizard first
        navigate('/onboarding-wizard', { replace: true });
      } catch (error) {
        console.error('Error in role creation:', error);
        // Fallback to onboarding wizard
        navigate('/onboarding-wizard', { replace: true });
      }
    };

    handleAuthCallback();
  }, [navigate, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-destructive">
              Authentication Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <div className="mt-4 text-center">
              <a 
                href="/auth" 
                className="text-primary hover:underline"
              >
                Return to Login
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            Completing Sign In...
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">
            Please wait while we complete your authentication...
          </p>
        </CardContent>
      </Card>
    </div>
  );
}