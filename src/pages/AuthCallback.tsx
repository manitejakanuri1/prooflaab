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
        // First, try to handle any auth state changes from URL params
        const { error: authError } = await supabase.auth.getSession();
        
        if (authError) {
          console.error('AuthCallback: Auth error:', authError);
          throw authError;
        }
        
        // Wait a moment for auth to process
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Get the session after auth callback
        const { data, error } = await supabase.auth.getSession();
        console.log('AuthCallback: Session data:', data);
        
        if (error) {
          console.error('AuthCallback: Session error:', error);
          throw error;
        }

        if (data.session?.user) {
          console.log('AuthCallback: User found, processing...');
          await handleSuccessfulAuth(data.session);
        } else {
          console.log('AuthCallback: No session found, redirecting to auth...');
          // If no session, redirect to auth page - this might be an email confirmation
          navigate('/auth?message=Email confirmed! Please log in to continue.', { replace: true });
        }
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

      // Check if email is confirmed - if not, redirect to auth with message
      if (!user.email_confirmed_at) {
        console.log('Email not confirmed, redirecting to auth');
        navigate('/auth?message=Please confirm your email address to continue', { replace: true });
        return;
      }

      // Get existing role first
      const { data: existingRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      const currentRole = existingRole?.role;

      // If role exists, redirect based on that role (ignore accountType from URL)
      if (currentRole) {
        console.log('Existing role found:', currentRole);
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

      // No existing role - this shouldn't happen with proper signup flow
      console.log('No existing role found, defaulting to student');
      // Create student role as fallback
      await supabase
        .from('user_roles')
        .insert({ user_id: user.id, role: 'student' });
      
      await supabase.from('students').insert({
        user_id: user.id,
        name: user.user_metadata?.full_name || '',
        email: user.email || ''
      });
      
      navigate('/student/dashboard', { replace: true });
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