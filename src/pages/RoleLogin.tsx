import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Logo } from "@/components/Logo";
import { GraduationCap, School, Rocket, Loader2, LucideIcon } from "lucide-react";

type AppRole = "student" | "college_admin" | "startup";

interface RoleConfig {
  role: AppRole;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  dashboard: string;
  onboarding: string;
  signupHint: string;
}

const CONFIG: Record<string, RoleConfig> = {
  student: {
    role: "student",
    title: "Student Sign In",
    subtitle: "Access your tasks, proofs, and portfolio.",
    icon: GraduationCap,
    dashboard: "/student/dashboard",
    onboarding: "/onboarding/student",
    signupHint: "student",
  },
  college: {
    role: "college_admin",
    title: "College Sign In",
    subtitle: "Manage your students and track their progress.",
    icon: School,
    dashboard: "/college/dashboard",
    onboarding: "/onboarding/college",
    signupHint: "college",
  },
  startup: {
    role: "startup",
    title: "Startup Sign In",
    subtitle: "Post tasks and review verified intern talent.",
    icon: Rocket,
    dashboard: "/startup/dashboard",
    onboarding: "/onboarding/startup",
    signupHint: "startup",
  },
};

interface RoleLoginProps {
  configKey: keyof typeof CONFIG;
}

export default function RoleLogin({ configKey }: RoleLoginProps) {
  const cfg = CONFIG[configKey];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const Icon = cfg.icon;

  // If already signed in as the right role, skip straight in.
  useEffect(() => {
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role, has_completed_wizard")
        .eq("user_id", user.id)
        .maybeSingle();
      if (roleData?.role === cfg.role) {
        navigate(roleData.has_completed_wizard ? cfg.dashboard : cfg.onboarding, { replace: true });
      }
    };
    check();
  }, [navigate, cfg]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await supabase.auth.signOut({ scope: "global" }).catch(() => {});

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      if (!data.user) throw new Error("Login failed. Please try again.");

      if (!data.user.email_confirmed_at) {
        await supabase.auth.signOut();
        throw new Error("Please confirm your email address before logging in.");
      }

      const { data: roleData, error: roleError } = await supabase
        .from("user_roles")
        .select("role, has_completed_wizard")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (roleError) throw roleError;

      if (roleData?.role !== cfg.role) {
        await supabase.auth.signOut();
        throw new Error(`This is the ${cfg.title.replace(" Sign In", "")} login. Your account is not a ${cfg.signupHint} account.`);
      }

      navigate(roleData.has_completed_wizard ? cfg.dashboard : cfg.onboarding, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Link to="/" className="inline-flex items-center justify-center space-x-2">
            <Logo className="h-12 w-12" />
            <span className="text-2xl font-bold text-foreground">ProofLabAI</span>
          </Link>
        </div>

        <Card>
          <CardHeader className="space-y-2 text-center">
            <div className="flex justify-center">
              <div className="rounded-full bg-primary/10 p-3">
                <Icon className="h-7 w-7 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold">{cfg.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{cfg.subtitle}</p>
          </CardHeader>

          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="role-email">Email</Label>
                <Input
                  id="role-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role-password">Password</Label>
                <Input
                  id="role-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  cfg.title
                )}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              New here or a different role?{" "}
              <Link to="/auth" className="text-primary hover:underline">
                Main sign in / sign up
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
