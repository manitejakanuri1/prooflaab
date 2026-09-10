import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Building, Bell, Shield, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Startup Settings.
 *
 * Every field on this screen is the startup's own row, read on mount and
 * written back on save. It previously rendered a sample company as hardcoded
 * defaultValues with no database code at all, which meant a real startup saw
 * a stranger's details as if they were their own and Update Profile silently
 * did nothing.
 *
 * The three notification switches are the matching columns on
 * user_preferences, which already existed and already carried the right
 * per-user RLS - they were simply never wired to anything.
 */

interface StartupProfile {
  startup_name: string;
  website: string | null;
  description: string | null;
  domain_industry: string | null;
  team_size: number | null;
}

interface Prefs {
  email_notifications: boolean;
  task_reminders: boolean;
  weekly_digest: boolean;
}

const EMPTY_PROFILE: StartupProfile = {
  startup_name: "",
  website: "",
  description: "",
  domain_industry: "",
  team_size: null,
};

const DEFAULT_PREFS: Prefs = {
  email_notifications: true,
  task_reminders: true,
  weekly_digest: true,
};

export function StartupSettingsPage() {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<StartupProfile>(EMPTY_PROFILE);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id ?? null;
    setUserId(uid);
    if (!uid) { setLoading(false); return; }

    const [profileRes, prefsRes] = await Promise.all([
      supabase
        .from("startup_profiles")
        .select("startup_name, website, description, domain_industry, team_size")
        .eq("user_id", uid)
        .maybeSingle(),
      supabase
        .from("user_preferences")
        .select("email_notifications, task_reminders, weekly_digest")
        .eq("user_id", uid)
        .maybeSingle(),
    ]);

    if (profileRes.data) setProfile(profileRes.data as unknown as StartupProfile);
    if (prefsRes.data) setPrefs(prefsRes.data as unknown as Prefs);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveProfile = async () => {
    if (!userId) return;
    if (!profile.startup_name.trim()) {
      toast({
        title: "Company name is required",
        description: "It is the one field other screens use to identify you.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    // upsert rather than update: a startup that signed up before this screen
    // existed has no profile row yet, and should not hit a silent no-op.
    const { error } = await supabase
      .from("startup_profiles")
      .upsert({
        user_id: userId,
        startup_name: profile.startup_name.trim(),
        website: profile.website?.trim() || null,
        description: profile.description?.trim() || null,
        domain_industry: profile.domain_industry?.trim() || null,
        team_size: profile.team_size,
      } as never, { onConflict: "user_id" });
    setSaving(false);

    if (error) {
      toast({ title: "Not saved", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Profile saved" });
  };

  const savePref = async (key: keyof Prefs, value: boolean) => {
    if (!userId) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });

    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: userId, ...prefs, [key]: value } as never, { onConflict: "user_id" });

    if (error) {
      // Put the switch back rather than leaving the screen claiming something
      // the database did not accept.
      setPrefs(previous);
      toast({ title: "Preference not saved", description: error.message, variant: "destructive" });
    }
  };

  const updatePassword = async () => {
    if (password.length < 8) {
      toast({ title: "Too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSavingPassword(false);

    if (error) {
      toast({ title: "Password not changed", description: error.message, variant: "destructive" });
      return;
    }
    setPassword("");
    setConfirmPassword("");
    toast({ title: "Password updated" });
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-muted-foreground">Manage your startup account and preferences</p>
      </div>

      {/* Company Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            Company Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company-name">Company Name</Label>
              <Input
                id="company-name"
                value={profile.startup_name}
                onChange={(e) => setProfile({ ...profile, startup_name: e.target.value })}
                placeholder="Your company's name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={profile.website ?? ""}
                onChange={(e) => setProfile({ ...profile, website: e.target.value })}
                placeholder="https://yourcompany.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-bio">Company Description</Label>
            <Textarea
              id="company-bio"
              value={profile.description ?? ""}
              onChange={(e) => setProfile({ ...profile, description: e.target.value })}
              placeholder="What your company does, in a couple of sentences."
              className="min-h-24"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={profile.domain_industry ?? ""}
                onChange={(e) => setProfile({ ...profile, domain_industry: e.target.value })}
                placeholder="e.g. Fintech, Health, Developer tools"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-size">Team Size</Label>
              <Input
                id="company-size"
                type="number"
                min={1}
                value={profile.team_size ?? ""}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    team_size: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="How many people work here"
              />
            </div>
          </div>

          <Button onClick={() => void saveProfile()} disabled={saving}>
            {saving ? "Saving…" : "Update Profile"}
          </Button>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">New Submissions</div>
              <div className="text-sm text-muted-foreground">Get notified when students submit their work</div>
            </div>
            <Switch
              checked={prefs.email_notifications}
              onCheckedChange={(v) => void savePref("email_notifications", v)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Task Deadlines</div>
              <div className="text-sm text-muted-foreground">Reminders about approaching task deadlines</div>
            </div>
            <Switch
              checked={prefs.task_reminders}
              onCheckedChange={(v) => void savePref("task_reminders", v)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Weekly Reports</div>
              <div className="text-sm text-muted-foreground">Weekly summary of submissions and activity</div>
            </div>
            <Switch
              checked={prefs.weekly_digest}
              onCheckedChange={(v) => void savePref("weekly_digest", v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>

          <Button onClick={() => void updatePassword()} disabled={savingPassword}>
            {savingPassword ? "Updating…" : "Update Password"}
          </Button>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="font-medium">Delete Account</div>
            <div className="text-sm text-muted-foreground mb-4">
              Deleting a startup account removes its jobs and sponsored work as well, so it is
              handled by an administrator rather than from this screen. Email support and the
              account will be closed.
            </div>
            <Button variant="destructive" disabled>
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
