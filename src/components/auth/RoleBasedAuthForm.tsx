import React, { useState } from 'react';
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

type AuthMode = 'login' | 'signup' | 'magic-link';
type UserRole = 'student' | 'college_admin' | 'startup' | 'admin';

interface RoleBasedAuthFormProps {
  onSuccess?: (role: UserRole) => void;
}

export default function RoleBasedAuthForm({ onSuccess }: RoleBasedAuthFormProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [loading, setLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSocialAuth = async (provider: 'google' | 'github') => {
    if (provider === 'google') {
      setIsGoogleLoading(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?type=${role}`,
          queryParams: {
            account_type: role
          }
        }
      });

      if (error) throw error;
    } catch (error: any) {
      console.error(`${provider} auth error:`, error);
      setError(error.message);
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

  const handleEmailPasswordAuth = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'login') {
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
        // Signup - just create account, no invite code validation here
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
          if (data.user.email_confirmed_at) {
            // User is immediately confirmed, handle redirect
            if (role === 'student') {
              // Assign student role immediately
              const { error: roleError } = await supabase
                .from('user_roles')
                .insert({ user_id: data.user.id, role: 'student' });
              
              if (roleError && !roleError.message.includes('duplicate')) {
                console.error('Student role assignment error:', roleError);
              }
              
              if (onSuccess) {
                onSuccess('student');
              }
            } else {
              // Redirect to invite code verification
              window.location.href = `/invite-verification?type=${role}`;
            }
          } else {
            setMessage("Please check your email and click the confirmation link to complete your registration!");
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
    if (mode === 'magic-link') {
      handleMagicLink();
    } else {
      handleEmailPasswordAuth();
    }
  };

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
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
                placeholder="Full Name"
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
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Create Account
              </Button>
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