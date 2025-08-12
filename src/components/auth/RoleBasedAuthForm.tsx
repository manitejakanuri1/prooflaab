import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Github, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type AuthMode = 'login' | 'signup' | 'magic-link';
type UserRole = 'student' | 'college_admin' | 'startup' | 'admin';

interface RoleBasedAuthFormProps {
  onSuccess?: (role: UserRole) => void;
}

export default function RoleBasedAuthForm({ onSuccess }: RoleBasedAuthFormProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>('student');
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const requiresInviteCode = role !== 'student';

  const handleSocialAuth = async (provider: 'google' | 'github') => {
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        }
      });
      
      if (error) throw error;
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        }
      });

      if (error) throw error;
      setMessage("Check your email for the magic link!");
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailPasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
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
        
        // Get user role and redirect
        if (data.user) {
          const { data: roleData } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', data.user.id)
            .single();
          
          const userRole = roleData?.role || 'student';
          if (onSuccess) {
            onSuccess(userRole);
          }
        }
      } else {
        // Validate invite code for restricted roles before signup
        if (requiresInviteCode) {
          // Simple validation - in production, this should be done server-side
          const validCodes = {
            'startup': ['STARTUP2024'],
            'college_admin': ['COLLEGE2024'], 
            'admin': ['ADMIN2024']
          };
          
          if (!validCodes[role]?.includes(inviteCode)) {
            throw new Error('Invalid invite code for ' + role + ' role');
          }
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: {
              full_name: fullName,
              role: role,
              invite_code: requiresInviteCode ? inviteCode : null,
            }
          }
        });
        
        if (error) throw error;
        
        // Handle role assignment after signup
        if (data.user && data.user.email_confirmed_at) {
          // Assign role
          const { error: roleError } = await supabase
            .from('user_roles')
            .insert({ user_id: data.user.id, role });
          
          if (roleError) {
            console.error('Role assignment error:', roleError);
          }
          
          if (onSuccess) {
            onSuccess(role);
          }
        } else if (data.user && !data.user.email_confirmed_at) {
          setMessage("Check your email for the confirmation link!");
        }
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const getRoleDisplayName = (role: UserRole) => {
    switch (role) {
      case 'student': return 'Student';
      case 'college_admin': return 'College Admin';
      case 'startup': return 'Startup';
      case 'admin': return 'System Admin';
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <img 
            src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
            alt="ProofLabAI Logo" 
            className="h-16 w-16"
          />
        </div>
        <CardTitle className="text-2xl font-bold">
          {mode === 'login' ? "Welcome Back" : 
           mode === 'signup' ? "Create Account" : 
           "Magic Link Login"}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
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

        {/* Social Authentication */}
        {mode !== 'magic-link' && (
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleSocialAuth('google')}
              disabled={loading}
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </Button>
            
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleSocialAuth('github')}
              disabled={loading}
            >
              <Github className="w-4 h-4 mr-2" />
              Continue with GitHub
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Auth Mode Tabs */}
        <div className="flex space-x-1 bg-muted p-1 rounded-lg">
          <Button
            type="button"
            variant={mode === 'login' ? 'default' : 'ghost'}
            size="sm"
            className="flex-1"
            onClick={() => setMode('login')}
          >
            Login
          </Button>
          <Button
            type="button"
            variant={mode === 'signup' ? 'default' : 'ghost'}
            size="sm"
            className="flex-1"
            onClick={() => setMode('signup')}
          >
            Sign Up
          </Button>
          <Button
            type="button"
            variant={mode === 'magic-link' ? 'default' : 'ghost'}
            size="sm"
            className="flex-1"
            onClick={() => setMode('magic-link')}
          >
            <Mail className="w-3 h-3 mr-1" />
            Magic Link
          </Button>
        </div>

        {/* Main Form */}
        <form 
          onSubmit={mode === 'magic-link' ? handleMagicLink : handleEmailPasswordAuth} 
          className="space-y-4"
        >
          {/* Role Selection for Signup */}
          {mode === 'signup' && (
            <div className="space-y-2">
              <Label htmlFor="role">Account Type</Label>
              <Select value={role} onValueChange={(value: UserRole) => setRole(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select your role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="college_admin">College Admin</SelectItem>
                  <SelectItem value="startup">Startup</SelectItem>
                  <SelectItem value="admin">System Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Full Name for Signup */}
          {mode === 'signup' && (
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
          )}
          
          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          
          {/* Password - Hidden for Magic Link */}
          {mode !== 'magic-link' && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          )}

          {/* Invite Code for Restricted Roles */}
          {mode === 'signup' && requiresInviteCode && (
            <div className="space-y-2">
              <Label htmlFor="inviteCode">
                Invite Code <span className="text-destructive">*</span>
              </Label>
              <Input
                id="inviteCode"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Enter your invite code"
                required
              />
              <p className="text-xs text-muted-foreground">
                {getRoleDisplayName(role)} accounts require a valid invite code.
              </p>
            </div>
          )}
          
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Loading..." : 
             mode === 'login' ? "Sign In" : 
             mode === 'signup' ? "Create Account" : 
             "Send Magic Link"}
          </Button>
        </form>

        {/* Test Invite Codes */}
        {mode === 'signup' && requiresInviteCode && (
          <Alert>
            <AlertDescription>
              <strong>Test Codes:</strong> STARTUP2024, COLLEGE2024, ADMIN2024
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}