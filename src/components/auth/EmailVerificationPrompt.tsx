import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, RefreshCw } from "lucide-react";

interface EmailVerificationPromptProps {
  email: string;
  onVerified?: () => void;
}

export default function EmailVerificationPrompt({ email, onVerified }: EmailVerificationPromptProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const resendVerification = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        }
      });

      if (error) throw error;
      setMessage("Verification email sent! Please check your inbox.");
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <Mail className="w-8 h-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold">Verify Your Email</CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4 text-center">
        <p className="text-muted-foreground">
          We've sent a verification email to <strong>{email}</strong>. 
          Please check your inbox and click the verification link to complete your registration.
        </p>

        {message && (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <Button
            onClick={resendVerification}
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 mr-2" />
                Resend Verification Email
              </>
            )}
          </Button>

          <Button
            onClick={() => window.location.href = '/auth'}
            variant="ghost"
            className="w-full"
          >
            Back to Login
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Didn't receive the email? Check your spam folder or try resending.
        </p>
      </CardContent>
    </Card>
  );
}