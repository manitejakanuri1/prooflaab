import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Mail, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface EmailVerificationScreenProps {
  email: string;
  userRole: 'student' | 'college_admin' | 'startup' | 'admin';
  onResendSuccess?: () => void;
}

export default function EmailVerificationScreen({ 
  email, 
  userRole, 
  onResendSuccess 
}: EmailVerificationScreenProps) {
  const [isResending, setIsResending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleResendEmail = async () => {
    setIsResending(true);
    setError(null);
    setMessage(null);

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?type=${userRole}`
        }
      });

      if (error) throw error;
      
      setMessage('Confirmation email resent! Please check your inbox.');
      if (onResendSuccess) {
        onResendSuccess();
      }
    } catch (error: any) {
      console.error('Resend email error:', error);
      setError(error.message || 'Failed to resend email. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center">
            <Mail className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold">Check Your Email</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 text-center">
        <div className="space-y-2">
          <p className="text-muted-foreground">
            We've sent a confirmation email to:
          </p>
          <p className="font-medium text-foreground">{email}</p>
        </div>
        
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Click the link in the email to verify your account and complete the registration process.
          </p>
          {(userRole === 'college_admin' || userRole === 'startup') && (
            <p className="text-sm text-muted-foreground">
              You'll also receive your invite code via email.
            </p>
          )}
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={handleResendEmail}
          disabled={isResending}
        >
          {isResending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Resend Confirmation Email
        </Button>

        {message && (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="text-xs text-muted-foreground">
          <p>Didn't receive the email? Check your spam folder or click resend.</p>
        </div>
      </CardContent>
    </Card>
  );
}