import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Mail, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface EmailConfirmationRequiredProps {
  email: string;
  userRole: 'student' | 'college_admin' | 'startup' | 'admin';
  onBackToLogin: () => void;
}

export default function EmailConfirmationRequired({ 
  email, 
  userRole, 
  onBackToLogin 
}: EmailConfirmationRequiredProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleResendEmail = async () => {
    setLoading(true);
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
      setMessage('Confirmation email sent! Please check your inbox.');
    } catch (error: any) {
      console.error('Resend email error:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center">
              <Mail className="h-8 w-8 text-blue-600" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Check Your Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center space-y-2">
            <p className="text-muted-foreground">
              We've sent a confirmation email to:
            </p>
            <p className="font-medium text-foreground break-all">{email}</p>
            <div className="flex items-center justify-center space-x-2 text-sm text-green-600 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="h-4 w-4" />
              <span>Account created successfully!</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="text-sm text-muted-foreground space-y-2">
              <p className="font-medium">Next steps:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Check your email inbox (and spam folder)</li>
                <li>Click the confirmation link in the email</li>
                <li>You'll be redirected back to complete your setup</li>
                {userRole !== 'student' && (
                  <li>Enter your invite code to activate your account</li>
                )}
              </ol>
            </div>

            <Button 
              onClick={handleResendEmail}
              variant="outline" 
              className="w-full"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Mail className="w-4 h-4 mr-2" />
              )}
              Resend Confirmation Email
            </Button>

            <Button 
              onClick={onBackToLogin}
              variant="ghost" 
              className="w-full"
            >
              Back to Login
            </Button>
          </div>

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

          <div className="text-xs text-muted-foreground text-center">
            <p>Didn't receive the email? Check your spam folder or try resending.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}