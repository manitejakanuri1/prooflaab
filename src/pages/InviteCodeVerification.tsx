import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

type UserRole = 'student' | 'college_admin' | 'startup' | 'admin';

export default function InviteCodeVerification() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accountType = searchParams.get('type') as UserRole;
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) {
      setError('Please enter an invite code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('No authenticated user found');
      }

      // Validate invite code - using existing database schema
      const { data: inviteData, error: inviteError } = await supabase
        .from('invite_codes')
        .select('id, code, role, used_by, expires_at, is_used')
        .eq('code', inviteCode.trim())
        .eq('role', accountType)
        .eq('is_used', false)
        .is('used_by', null)
        .maybeSingle();

      if (inviteError || !inviteData) {
        setError('Invite code is incorrect or expired');
        return;
      }

      // Mark code as used and assign role
      const { error: updateError } = await supabase
        .from('invite_codes')
        .update({ 
          used_by: user.id, 
          is_used: true 
        })
        .eq('id', inviteData.id);

      if (updateError) throw updateError;

      // Assign role to user
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: user.id, role: accountType })
        .select()
        .single();

      if (roleError && !roleError.message.includes('duplicate')) {
        throw roleError;
      }

      // Redirect to appropriate dashboard
      switch (accountType) {
        case 'startup':
          navigate('/startup/dashboard', { replace: true });
          break;
        case 'college_admin':
          navigate('/college/dashboard', { replace: true });
          break;
        case 'admin':
          navigate('/admin/dashboard', { replace: true });
          break;
        default:
          navigate('/student/dashboard', { replace: true });
      }
    } catch (error: any) {
      console.error('Invite code validation error:', error);
      setError(error.message || 'Failed to validate invite code');
    } finally {
      setLoading(false);
    }
  };

  if (!accountType || accountType === 'student') {
    // Students don't need invite codes, redirect directly
    navigate('/student/dashboard', { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            Enter Invite Code
          </CardTitle>
          <p className="text-muted-foreground">
            You need an invite code to access the {accountType === 'college_admin' ? 'College' : accountType} dashboard
          </p>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="text"
                placeholder="Enter your invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
                className="text-center tracking-wider"
              />
            </div>
            
            <Button 
              type="submit" 
              className="w-full" 
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Validating...
                </>
              ) : (
                'Verify Code'
              )}
            </Button>
          </form>
          
          <div className="mt-4 text-center">
            <button 
              onClick={() => navigate('/auth')}
              className="text-sm text-muted-foreground hover:underline"
            >
              Back to login
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}