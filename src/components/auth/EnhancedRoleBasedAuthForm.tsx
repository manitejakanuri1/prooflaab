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
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';
import { FaGoogle, FaGithub } from 'react-icons/fa';
import PasswordInput, { isPasswordValid } from './PasswordInput';
import EmailVerificationScreen from './EmailVerificationScreen';
import InviteCodeVerificationForm from './InviteCodeVerificationForm';
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

type AuthMode = 'login' | 'signup' | 'magic-link' | 'forgot-password';
type UserRole = 'student' | 'college_admin' | 'startup' | 'admin';
type AuthStep = 'form' | 'email-verification' | 'invite-code';

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
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
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

  // Dynamic redirect URL helper
  const getRedirectUrl = () => {
    const currentOrigin = window.location.origin;
    
    // For Lovable preview environments, use the current origin
    if (currentOrigin.includes('lovable.app') || currentOrigin.includes('lovableproject.com')) {
      return `${currentOrigin}/auth/callback`;
    }
    
    // For localhost development
    if (currentOrigin.includes('localhost')) {
      return `${currentOrigin}/auth/callback`;
    }
    
    // For production or staging environments
    return `${currentOrigin}/auth/callback`;
  };

  const cleanupAuthState = () => {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('supabase.auth.') || key.includes('sb-')) {
        localStorage.removeItem(key);
      }
    });
  };

  const handleSocialAuth = async (provider: 'google' | 'github') => {
    if (provider === 'google') {
      setIsGoogleLoading(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      cleanupAuthState();
      await supabase.auth.signOut({ scope: 'global' }).catch(() => {});

      // Social sign-in is students only, so the account type is fixed rather
      // than carried through the provider round trip.
      //
      // It used to send `?type=${role}`, which the provider frequently dropped
      // on the way back — and AuthCallback falls back to 'student' when the
      // type is missing. A college or startup signing in with Google was
      // therefore turned into a student with no warning. The `account_type`
      // query param was never a fix either: providers ignore fields they do not
      // know, so it never reached us.
      const redirectUrl = `${getRedirectUrl()}?type=student`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectUrl }
      });

      if (error) {
        console.error(`OAuth error for ${provider}:`, error);
        if (error.message?.includes('Unsupported provider') || error.message?.includes('not enabled')) {
          throw new Error(`${provider === 'google' ? 'Google' : 'GitHub'} sign-in is not enabled. Please contact support or use email/password authentication.`);
        }
        if (error.message?.includes('Invalid login credentials') || error.message?.includes('OAuth')) {
          throw new Error(`${provider === 'google' ? 'Google' : 'GitHub'} OAuth is not properly configured. Please check the credentials in Supabase settings.`);
        }
        throw error;
      }
    } catch (error: any) {
      console.error(`${provider} auth error:`, error);
      
      // Provide specific error messages for common OAuth issues
      if (error.message?.includes('redirect_uri_mismatch')) {
        setError(`OAuth redirect URL mismatch. Please ensure ${window.location.origin}/auth/callback is added to your ${provider === 'google' ? 'Google Cloud Console' : 'GitHub OAuth App'} authorized redirect URIs.`);
      } else if (error.message?.includes('invalid_client')) {
        setError(`Invalid OAuth credentials. Please check your ${provider === 'google' ? 'Google' : 'GitHub'} Client ID and Secret in Supabase settings.`);
      } else {
        setError(error.message || `Failed to authenticate with ${provider === 'google' ? 'Google' : 'GitHub'}`);
      }
    } finally {
      setIsGoogleLoading(false);
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const redirectUrl = `${getRedirectUrl()}?type=${role}`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            account_type: role
          }
        }
      });

      if (error) throw error;
      setMessage('Check your email for the magic link!');
    } catch (error: any) {
      console.error('Magic link error:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
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

  const generateInviteCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
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
          console.log('User created successfully:', data.user.id);
          
          try {
            console.log('Attempting to create user role:', { user_id: data.user.id, role: role });
            // Create user role record immediately
            const { error: roleError } = await supabase
              .from('user_roles')
              .insert({ 
                user_id: data.user.id, 
                role: role
              });
            
            if (roleError) {
              console.error('Role assignment error:', roleError);
              console.log('User ID:', data.user.id, 'Role:', role);
              console.log('Auth user state:', data.user);
              if (!roleError.message.includes('duplicate')) {
                throw new Error('Failed to assign user role. Please try again.');
              }
            } else {
              console.log('Role successfully assigned:', role);
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
              console.log('Redirecting to onboarding for role:', role);
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
    
    if (mode === 'magic-link') {
      handleMagicLink();
    } else if (mode === 'forgot-password') {
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
           mode === 'forgot-password' ? 'Reset Password' : 
           'Magic Link'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Social sign-in, students only. A college or startup arriving this
            way cannot be told apart from a student on the way back, so the
            buttons are simply not offered to them — they sign in with email and
            password, which carries the account type reliably. */}
        {role === 'student' && (
          <>
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleSocialAuth('google')}
                disabled={isGoogleLoading || loading}
              >
                {isGoogleLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FaGoogle className="w-4 h-4 mr-2" />
                )}
                Continue with Google
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleSocialAuth('github')}
                disabled={loading || isGoogleLoading}
              >
                {loading && !isGoogleLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FaGithub className="w-4 h-4 mr-2" />
                )}
                Continue with GitHub
              </Button>
            </div>

            <Separator />
          </>
        )}

        {/* Auth Mode Tabs */}
        <Tabs value={mode} onValueChange={(value) => setMode(value as AuthMode)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
            <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
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
                  <SelectItem value="startup">Startup</SelectItem>
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

          <TabsContent value="magic-link" className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Account Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="college_admin">College Admin</SelectItem>
                  <SelectItem value="startup">Startup</SelectItem>
                </SelectContent>
              </Select>

              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Send Magic Link
              </Button>
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