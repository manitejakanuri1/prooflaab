import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Key } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface InviteCodeVerificationFormProps {
  email: string;
  accountType: 'college_admin' | 'startup';
  onSuccess: (role: 'college_admin' | 'startup') => void;
}

export default function InviteCodeVerificationForm({
  email,
  accountType,
  onSuccess
}: InviteCodeVerificationFormProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      // Use the new verification function
      const { data, error } = await supabase.rpc('verify_invite_code_and_activate', {
        _code: inviteCode.trim().toUpperCase(),
        _user_id: user.id,
        _role: accountType
      });

      if (error) throw error;

      if (data?.success) {
        onSuccess(accountType);
      } else {
        setError(data?.message || 'Invalid or expired invite code');
      }
    } catch (error: any) {
      console.error('Invite code verification error:', error);
      setError(error.message || 'Failed to verify invite code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center">
            <Key className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold">Enter Invite Code</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center">
          <p className="text-muted-foreground mb-2">
            Please enter the invite code sent to:
          </p>
          <p className="font-medium text-foreground">{email}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="text"
              placeholder="Enter invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              className="text-center font-mono text-lg tracking-widest"
              maxLength={6}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading || !inviteCode}>
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            Verify Code
          </Button>
        </form>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="text-xs text-muted-foreground text-center">
          <p>Didn't receive your invite code? Please contact support.</p>
        </div>
      </CardContent>
    </Card>
  );
}