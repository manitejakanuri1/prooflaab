import React, { useState, useEffect } from 'react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { logAuthEvent, classifyAuthError } from '@/lib/securityLog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';
import PasswordInput, { isPasswordValid } from './PasswordInput';
import EmailConfirmationRequired from './EmailConfirmationRequired';

const signupSchema = z.object({
  email: z.string().trim().email('Invalid email format').max(255, 'Email too long'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long'),
  fullName: z.string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters')
    .regex(/^[a-zA-Z\s'.,-]+$/, 'Name contains invalid characters'),
});

const loginSchema = z.object({
  email: z.string().trim().email('Invalid email format').max(255, 'Email too long'),
  password: z.string().min(1, 'Password is required'),
});

/** The text of a thrown value, whatever it is. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? '');

type AuthMode = 'login' | 'signup' | 'forgot-password';
type UserRole = 'student' | 'college_admin' | 'startup' | 'admin' | 'recruiter';
type AuthStep = 'form' | 'email-verification';

interface EnhancedRoleBasedAuthFormProps {
  onSuccess?: (role: UserRole) => void;
}

export default function EnhancedRoleBasedAuthForm({ onSuccess }: EnhancedRoleBasedAuthFormProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [authStep, setAuthStep] = useState<AuthStep>('form');
  
  // Clear form fields when switching account types
  useEffect(() => {
    setEmail('');
    setPassword('');
    setFullName('');
    setError(null);
    setMessage(null);
  }, [role]);

  // Clear form fields when switching auth modes  
  useEffect(() => {
    setEmail('');
    setPassword('');
    setFullName('');
    setError(null);
    setMessage(null);
    setAuthStep('form'); // Reset auth step when switching modes
  }, [mode]);

  /**
   * Wipe any half-finished session before starting a new one.
   *
   * Remove stale authentication keys left by pre-BFF deployments before
   * beginning a fresh login. The current BFF session itself is HttpOnly and
   * cannot be read or deleted through JavaScript storage.
   */
  const cleanupAuthState = () => {
    Object.keys(localStorage).forEach((key) => {
      if (
        key.startsWith('supabase.auth.') ||
        key.includes('sb-') ||
        key.startsWith('prooflab.auth.')
      ) {
        localStorage.removeItem(key);
      }
    });
  };

  const handleForgotPassword = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const resetUrl = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: resetUrl
      });

      if (error) throw error;
      // Logged on success only: a reset request that failed reveals nothing,
      // but one that succeeded means a reset link is now in somebody's inbox.
      logAuthEvent('password_reset_requested', email);
      setMessage('Password reset email sent! Check your inbox for the reset link.');
    } catch (error: unknown) {
      console.error('Forgot password error:', error);
      setError(messageOf(error));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailPasswordAuth = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'login') {
        cleanupAuthState();
        await supabase.auth.signOut({ scope: 'global' }).catch(() => {});

        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          logAuthEvent('login_failed', email, classifyAuthError(error.message));
          throw error;
        }

        if (data.user) {
          // Recorded too: a burst of failures matters far less if you cannot
          // see whether any of them eventually worked.
          logAuthEvent('login_succeeded', email);

          // Check if email is confirmed
          if (!data.user.email_confirmed_at) {
            setError('Please confirm your email address before logging in. Check your inbox for the confirmation email.');
            await supabase.auth.signOut();
            return;
          }

          // Get user role after login
          const { data: userRole } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', data.user.id)
            .maybeSingle();

          // No role means the account was never set up here. Guessing "student"
          // sent colleges and admins to the student pages.
          if (!userRole?.role) {
            await supabase.auth.signOut();
            setError('Account access is managed by your college or platform administrator.');
            return;
          }
          
          if (onSuccess) {
            onSuccess(userRole.role);
          }
        }
      }
      // No other branch: accounts are created by an administrator or a college,
      // never from this form (the server refuses /api/auth/signup as well).
    } catch (error: unknown) {
      console.error('Auth error:', error);
      const reason = messageOf(error);
      
      // Provide better error messages for common issues
      if (reason.includes('Email already registered') ||
          reason.includes('already exists')) {
        setError('This email is already registered. Please login instead or use a different email.');
      } else if (reason.includes('Invalid login credentials')) {
        setError('Invalid email or password. Please check your credentials and try again.');
      } else if (reason.includes('email not confirmed')) {
        setError('Please confirm your email address before logging in. Check your inbox for the confirmation email.');
      } else {
        setError(reason);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    // Validate inputs with zod before proceeding
    try {
      if (mode === 'signup') {
        signupSchema.parse({ email, password, fullName });
        if (!isPasswordValid(password)) {
          setError('Password is too weak. Please choose a stronger password.');
          return;
        }
      } else if (mode === 'login') {
        loginSchema.parse({ email, password });
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.issues[0].message);
        return;
      }
    }
    
    if (mode === 'forgot-password') {
      handleForgotPassword();
    } else {
      handleEmailPasswordAuth();
    }
  };

  // Render different screens based on auth step
  if (authStep === 'email-verification') {
    return (
      <EmailConfirmationRequired
        email={email}
        userRole={role === 'admin' ? 'student' : role}
        onBackToLogin={() => {
          setAuthStep('form');
          setMode('login');
          setEmail('');
          setPassword('');
          setError(null);
          setMessage(null);
        }}
      />
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto rounded-3xl shadow-2xl border border-border/50 bg-card dark:bg-gray-800/95 backdrop-blur-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">
          {mode === 'login' ? 'Welcome Back' :
           mode === 'signup' ? 'Create Account' :
           'Reset Password'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Auth Mode Tabs */}
        <Tabs value={mode} onValueChange={(value) => setMode(value as AuthMode)}>
          <TabsList className="grid w-full grid-cols-1">
            <TabsTrigger value="login">Login</TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="Password"
                required
              />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Sign In
              </Button>
            </form>
            <div className="text-center">
              <button
                type="button"
                onClick={() => setMode('forgot-password')}
                className="text-sm text-primary hover:underline"
              >
                Forgot Password?
              </button>
            </div>
          </TabsContent>

          {/* Public self-sign-up is disabled. Accounts are provisioned by a college or platform administrator. */}

          <TabsContent value="forgot-password" className="space-y-4">
            <div className="text-center mb-4">
              <p className="text-sm text-muted-foreground">
                Enter your email address and we'll send you a link to reset your password.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Send Reset Link
              </Button>
            </form>
            <div className="text-center">
              <button
                type="button"
                onClick={() => setMode('login')}
                className="text-sm text-primary hover:underline"
              >
                Back to Login
              </button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Error and Message Display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {message && (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}