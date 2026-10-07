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

  // Wherever the app is being served from — localhost, a preview build, the
  // live site — send the user back to the same place after signing in.
  const getRedirectUrl = () => `${window.location.origin}/auth/callback`;

  /**
   * Wipe any half-finished session before starting a new one.
   *
   * prooflab.auth.google is where the Google session lives. It was missing from
   * this list, so after the move a stuck session survived every attempt to log
   * in again - the one failure the removed "clear session" buttons existed to
   * rescue people from.
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
    } catch (error: any) {
      console.error('Forgot password error:', error);
      setError(error.message);
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

          const currentRole = userRole?.role || 'student';
          
          if (onSuccess) {
            onSuccess(currentRole);
          }
        }
      } else {
        // Signup - create account with proper email confirmation
        const redirectUrl = `${getRedirectUrl()}?type=${role}`;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectUrl,
            data: {
              full_name: fullName,
              account_type: role
            }
          }
        });
        
        if (error) {
          logAuthEvent('signup_failed', email, classifyAuthError(error.message));
          // Handle specific signup errors
          if (error.message?.includes('User already registered')) {
            throw new Error('Email already registered. Please login instead.');
          } else if (error.message?.includes('already exists')) {
            throw new Error('An account with this email already exists. Please login.');
          } else if (error.message?.includes('email not confirmed')) {
            throw new Error('Please check your email and confirm your account first.');
          }
          throw error;
        }
        
        // Handle successful signup
        if (data.user) {
          
          try {
            // Create user role record immediately
            const { error: roleError } = await supabase
              .from('user_roles')
              .insert({ 
                user_id: data.user.id, 
                role: role
              });
            
            if (roleError) {
              console.error('Role assignment error:', roleError);
              if (!roleError.message.includes('duplicate')) {
                throw new Error('Failed to assign user role. Please try again.');
              }
            }

            // Create role-specific records based on user type
            try {
              if (role === 'student') {
                // Nothing to write here. The student's row in student_profiles
                // is created by ensureStudentProfile() as soon as the session
                // lands, which is the one place that owns it. This used to also
                // insert into `students`, a second table nothing reads.
              } else if (role === 'college_admin') {
                // Create college record with pending status
                const { error: collegeError } = await supabase.from('colleges').insert({
                  user_id: data.user.id,
                  name: fullName,
                  email: email,
                  status: 'pending'
                });
                if (collegeError) throw collegeError;
              } else if (role === 'startup') {
                // Create startup record with pending status
                const { error: startupError } = await supabase.from('startups').insert({
                  user_id: data.user.id,
                  name: fullName,
                  email: email,
                  status: 'pending'
                });
                if (startupError) throw startupError;
              }
            } catch (recordError: any) {
              console.error('Failed to create user record:', recordError);
              // Don't throw here - the user account is created, just log the error
            }

            // Send onboarding email (don't let this fail the signup)
            try {
              await supabase.functions.invoke('send-onboarding-email', {
                body: {
                  email: email,
                  name: fullName,
                  userType: role === 'college_admin' ? 'college' : role,
                  origin: window.location.origin
                }
              });
            } catch (emailError) {
              console.error('Failed to send onboarding email:', emailError);
            }

            // For roles that need onboarding, redirect directly to onboarding
            if (role === 'college_admin' || role === 'startup' || role === 'student') {
              if (onSuccess) {
                onSuccess(role);
              }
            } else {
              // For other roles, show email verification
              setMessage('Account created successfully! Please check your email to confirm your account before you can log in.');
              setAuthStep('email-verification');
            }

          } catch (setupError: any) {
            console.error('User setup error:', setupError);
            // If role assignment fails, still show verification but with a warning
            setMessage('Account created! Please check your email to confirm. Some account setup may need to be completed after login.');
            setAuthStep('email-verification');
          }
        }
      }
    } catch (error: any) {
      console.error('Auth error:', error);
      
      // Provide better error messages for common issues
      if (error.message?.includes('Email already registered') || 
          error.message?.includes('already exists')) {
        setError('This email is already registered. Please login instead or use a different email.');
      } else if (error.message?.includes('Invalid login credentials')) {
        setError('Invalid email or password. Please check your credentials and try again.');
      } else if (error.message?.includes('email not confirmed')) {
        setError('Please confirm your email address before logging in. Check your inbox for the confirmation email.');
      } else {
        setError(error.message);
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
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

          <TabsContent value="signup" className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Account Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="college_admin">College Admin</SelectItem>
                  <SelectItem value="startup">Company</SelectItem>
                </SelectContent>
              </Select>

              <Input
                type="text"
                placeholder={
                  role === 'student' ? 'Full Name' : 
                  role === 'college_admin' ? 'College Name' : 
                  'Company Name'
                }
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
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
                showStrengthMeter
              />
              <Button 
                type="submit" 
                className="w-full" 
                disabled={loading || !isPasswordValid(password)}
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Create Account
              </Button>
              {password && !isPasswordValid(password) && (
                <p className="text-sm text-destructive text-center">
                  Password too weak
                </p>
              )}
            </form>
          </TabsContent>

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