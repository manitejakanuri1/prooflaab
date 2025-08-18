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
        // Handle auth callback from URL fragments for OAuth
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        
        if (accessToken) {
          // OAuth callback - exchange for session
          const { data, error } = await supabase.auth.getSession();
          console.log('AuthCallback: OAuth session data:', data);
          
          if (error) {
            console.error('AuthCallback: OAuth session error:', error);
            throw error;
          }
          
          if (data.session) {
            await handleSuccessfulAuth(data.session);
            return;
          }
        }
        
        // Handle regular email confirmation callback
        const { data, error } = await supabase.auth.getSession();
        
        console.log('AuthCallback: Session data:', data);
        
        if (error) {
          console.error('AuthCallback: Session error:', error);
          throw error;
        }

        if (!data.session) {
          console.error('AuthCallback: No session found');
          throw new Error('No session found after callback');
        }

        await handleSuccessfulAuth(data.session);
      } catch (error: any) {
        console.error('Auth callback error:', error);
        setError(error.message);
        setLoading(false);
      }
    };

    const handleSuccessfulAuth = async (session: any) => {
      const user = session.user;
      const accountType = searchParams.get('type') || user.user_metadata?.account_type;
      
      console.log('AuthCallback: User:', user);
      console.log('AuthCallback: Account type:', accountType);

      // Handle role assignment for social auth or email confirmation
      if (accountType === 'student') {
        // Assign student role immediately
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({ user_id: user.id, role: 'student' });
        
        if (roleError && !roleError.message.includes('duplicate')) {
          console.error('Student role assignment error:', roleError);
        }
        
        // Create student profile if needed
        try {
          await supabase.from('student_profiles').insert({
            user_id: user.id,
            full_name: user.user_metadata?.full_name || '',
            email: user.email || ''
          });
        } catch (profileError: any) {
          if (!profileError.message?.includes('duplicate')) {
            console.error('Student profile creation error:', profileError);
          }
        }
        
        navigate('/student/dashboard', { replace: true });
      } else if (accountType && ['startup', 'college_admin'].includes(accountType)) {
        // Assign role
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({ user_id: user.id, role: accountType });
        
        if (roleError && !roleError.message.includes('duplicate')) {
          console.error('Role assignment error:', roleError);
        }

        // Check if user already has profile record
        if (accountType === 'college_admin') {
          const { data: collegeRecord } = await supabase
            .from('colleges')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

          if (!collegeRecord) {
            // No college record exists, redirect to onboarding
            navigate('/onboarding/college', { replace: true });
          } else {
            navigate('/college/dashboard', { replace: true });
          }
        } else if (accountType === 'startup') {
          const { data: startupRecord } = await supabase
            .from('startups')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

          if (!startupRecord) {
            // No startup record exists, redirect to onboarding
            navigate('/onboarding/startup', { replace: true });
          } else {
            navigate('/startup/dashboard', { replace: true });
          }
        }
      } else {
        // Check existing role and redirect accordingly
        const { data: userRole } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();

        const role = userRole?.role || 'student';
        
        // Redirect based on role
        switch (role) {
          case 'admin':
            navigate('/admin/dashboard', { replace: true });
            break;
          case 'college_admin':
            // Check if college record exists
            const { data: collegeRecord } = await supabase
              .from('colleges')
              .select('id')
              .eq('user_id', user.id)
              .maybeSingle();

            if (!collegeRecord) {
              navigate('/onboarding/college', { replace: true });
            } else {
              navigate('/college/dashboard', { replace: true });
            }
            break;
          case 'startup':
            // Check if startup record exists
            const { data: startupRecord } = await supabase
              .from('startups')
              .select('id')
              .eq('user_id', user.id)
              .maybeSingle();

            if (!startupRecord) {
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