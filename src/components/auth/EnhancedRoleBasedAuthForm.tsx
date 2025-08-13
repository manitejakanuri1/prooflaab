import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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

type AuthMode = 'login' | 'signup' | 'magic-link';
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

      console.log(`Attempting ${provider} OAuth with role: ${role}`);
      console.log(`Redirect URL: ${window.location.origin}/auth/callback?type=${role}`);

      // Enhanced OAuth call with better error handling
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?type=${role}`,
          queryParams: {
            account_type: role
          }
        }
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
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?type=${role}`,
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

        if (error) throw error;

        if (data.user) {
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
        // Signup - create account and send confirmation email
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?type=${role}`,
            data: {
              full_name: fullName,
              account_type: role
            }
          }
        });
        
        if (error) throw error;
        
        // Handle successful signup
        if (data.user) {
          // Create user role record
          const { error: roleError } = await supabase
            .from('user_roles')
            .insert({ user_id: data.user.id, role: role });
          
          if (roleError && !roleError.message.includes('duplicate')) {
            console.error('Role assignment error:', roleError);
          }

          // Create role-specific profile record
          try {
            if (role === 'student') {
              await supabase.from('student_profiles').insert({
                user_id: data.user.id,
                full_name: fullName,
                email: email
              });
            } else if (role === 'college_admin') {
              await supabase.from('colleges').insert({
                user_id: data.user.id,
                college_name: fullName,
                email: email
              });
            } else if (role === 'startup') {
              await supabase.from('startups').insert({
                user_id: data.user.id,
                company_name: fullName,
                email: email
              });
            }
          } catch (profileError: any) {
            console.error('Profile creation error:', profileError);
            // Don't block signup for profile creation errors
          }

          if (data.user.email_confirmed_at) {
            // User is immediately confirmed, redirect to dashboard
            if (onSuccess) {
              onSuccess(role);
            }
          } else {
            // Show email verification screen
            setMessage('Account created successfully! Please check your email to confirm your account.');
            setAuthStep('email-verification');
          }
        }
      }
    } catch (error: any) {
      console.error('Auth error:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check password strength for signup
    if (mode === 'signup' && !isPasswordValid(password)) {
      setError('Password is too weak. Please choose a stronger password.');
      return;
    }
    
    if (mode === 'magic-link') {
      handleMagicLink();
    } else {
      handleEmailPasswordAuth();
    }
  };

  // Render different screens based on auth step
  if (authStep === 'email-verification') {
    return (
      <EmailVerificationScreen
        email={email}
        userRole={role}
        onResendSuccess={() => setMessage('Confirmation email resent!')}
      />
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">
          {mode === 'login' ? 'Welcome Back' : mode === 'signup' ? 'Create Account' : 'Magic Link'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Social Auth Buttons */}
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