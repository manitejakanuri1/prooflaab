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
      // Validate invite code
      const { data: inviteData, error: inviteError } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('code', inviteCode.toUpperCase())
        .eq('role', accountType)
        .eq('is_used', false)
        .gte('expires_at', new Date().toISOString())
        .maybeSingle();

      if (inviteError || !inviteData) {
        throw new Error('Invalid invite code. Please contact admin.');
      }

      // Mark invite code as used
      const { error: updateError } = await supabase
        .from('invite_codes')
        .update({ is_used: true })
        .eq('id', inviteData.id);

      if (updateError) {
        throw new Error('Failed to validate invite code');
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      // Create appropriate profile record
      if (accountType === 'college_admin') {
        const { error: profileError } = await supabase
          .from('colleges')
          .insert({
            user_id: user.id,
            college_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'College',
            email: user.email!
          });

        if (profileError && !profileError.message.includes('duplicate')) {
          throw new Error('Failed to create college profile');
        }
      } else if (accountType === 'startup') {
        const { error: profileError } = await supabase
          .from('startups')
          .insert({
            user_id: user.id,
            company_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Company',
            email: user.email!
          });

        if (profileError && !profileError.message.includes('duplicate')) {
          throw new Error('Failed to create startup profile');
        }
      }

      onSuccess(accountType);
    } catch (error: any) {
      console.error('Invite code verification error:', error);
      setError(error.message);
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