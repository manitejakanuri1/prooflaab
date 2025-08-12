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
      try {
        // Handle the auth callback
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          throw error;
        }

        if (!data.session) {
          throw new Error('No session found');
        }

        const user = data.session.user;
        const accountType = searchParams.get('type') || user.user_metadata?.account_type;

        // Handle role assignment for social auth or email confirmation
        if (accountType === 'student') {
          // Assign student role immediately
          const { error: roleError } = await supabase
            .from('user_roles')
            .insert({ user_id: user.id, role: 'student' });
          
          if (roleError && !roleError.message.includes('duplicate')) {
            console.error('Student role assignment error:', roleError);
          }
          
          navigate('/student/dashboard', { replace: true });
        } else if (accountType && ['startup', 'college_admin', 'admin'].includes(accountType)) {
          // Redirect to invite code verification for restricted roles
          navigate(`/invite-verification?type=${accountType}`, { replace: true });
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
        }
      } catch (error: any) {
        console.error('Auth callback error:', error);
        setError(error.message);
        setLoading(false);
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