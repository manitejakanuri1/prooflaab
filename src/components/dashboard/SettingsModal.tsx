
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { User, Bell, Shield, Palette, FileText } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { profile, loading: profileLoading } = useStudentProfile();
  const { preferences, loading: preferencesLoading, updatePreferences } = useUserPreferences();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  
  // Profile settings state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");

  const loading = profileLoading || preferencesLoading;

  // Update form data when profile loads
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setEmail(profile.email || "");
    }
  }, [profile]);

  // Fetch bio from portfolio
  useEffect(() => {
    const fetchBio = async () => {
      if (profile?.id) {
        const { data } = await supabase
          .from('student_portfolios')
          .select('bio')
          .eq('student_id', profile.id)
          .single();
        
        if (data?.bio) {
          setBio(data.bio);
        }
      }
    };
    fetchBio();
  }, [profile?.id]);

  const handleSaveProfile = async () => {
    if (!profile?.id) return;
    
    setSaving(true);
    try {
      // Update student profile
      const { error: profileError } = await supabase
        .from('student_profiles')
        .update({
          full_name: fullName,
          updated_at: new Date().toISOString()
        })
        .eq('id', profile.id);

      if (profileError) throw profileError;

      // Update bio in portfolio
      const { error: portfolioError } = await supabase
        .from('student_portfolios')
        .upsert({
          student_id: profile.id,
          bio: bio,
        });

      if (portfolioError) throw portfolioError;

      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    const success = await updatePreferences({
      email_notifications: preferences.email_notifications,
      push_notifications: preferences.push_notifications,
      task_reminders: preferences.task_reminders,
      weekly_digest: preferences.weekly_digest,
    });
  };

  const handleSavePrivacy = async () => {
    const success = await updatePreferences({
      portfolio_public: preferences.portfolio_public,
      show_xp_rank: preferences.show_xp_rank,
      show_progress_to_others: preferences.show_progress_to_others,
    });
  };

  const handleSaveAppearance = async () => {
    const success = await updatePreferences({
      theme: preferences.theme,
      compact_mode: preferences.compact_mode,
    });
  };

  if (loading) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Manage your account settings and preferences.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="privacy" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Privacy
            </TabsTrigger>
            <TabsTrigger value="appearance" className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Appearance
            </TabsTrigger>
          </TabsList>

          <div className="mt-6 max-h-[60vh] overflow-y-auto">
            <TabsContent value="profile" className="space-y-6">
              <div className="flex items-center space-x-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={profile?.profile_photo_url || ""} alt={profile?.full_name} />
                  <AvatarFallback className="text-lg">
                    {profile?.full_name?.split(" ").map((n) => n[0]).join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <Button variant="outline" size="sm">
                    Change Photo
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    JPG, PNG or GIF. Max 2MB.
                  </p>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell us about yourself..."
                  rows={4}
                />
              </div>

              <Button onClick={handleSaveProfile} disabled={saving}>
                {saving ? "Saving..." : "Save Profile"}
              </Button>
            </TabsContent>

            <TabsContent value="notifications" className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive notifications via email
                    </p>
                  </div>
                  <Switch
                    checked={preferences.email_notifications}
                    onCheckedChange={(checked) => 
                      updatePreferences({ email_notifications: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Push Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive push notifications in browser
                    </p>
                  </div>
                  <Switch
                    checked={preferences.push_notifications}
                    onCheckedChange={(checked) => 
                      updatePreferences({ push_notifications: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Task Reminders</Label>
                    <p className="text-sm text-muted-foreground">
                      Get reminded about upcoming task deadlines
                    </p>
                  </div>
                  <Switch
                    checked={preferences.task_reminders}
                    onCheckedChange={(checked) => 
                      updatePreferences({ task_reminders: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Weekly Digest</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive weekly summary of your progress
                    </p>
                  </div>
                  <Switch
                    checked={preferences.weekly_digest}
                    onCheckedChange={(checked) => 
                      updatePreferences({ weekly_digest: checked })
                    }
                  />
                </div>
              </div>

              <Button onClick={handleSaveNotifications}>
                Save Notification Settings
              </Button>
            </TabsContent>

            <TabsContent value="privacy" className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Public Profile</Label>
                    <p className="text-sm text-muted-foreground">
                      Make your profile visible to other students
                    </p>
                  </div>
                  <Switch
                    checked={preferences.portfolio_public}
                    onCheckedChange={(checked) => 
                      updatePreferences({ portfolio_public: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Show XP & Rank</Label>
                    <p className="text-sm text-muted-foreground">
                      Display your XP and ranking on leaderboard
                    </p>
                  </div>
                  <Switch
                    checked={preferences.show_xp_rank}
                    onCheckedChange={(checked) => 
                      updatePreferences({ show_xp_rank: checked })
                    }
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Data Export</Label>
                <p className="text-sm text-muted-foreground">
                  Download a copy of your data
                </p>
                <Button variant="outline" className="w-fit">
                  <FileText className="h-4 w-4 mr-2" />
                  Export Data
                </Button>
              </div>

              <Button onClick={handleSavePrivacy}>
                Save Privacy Settings
              </Button>
            </TabsContent>

            <TabsContent value="appearance" className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Theme</Label>
                  <Select 
                    value={preferences.theme} 
                    onValueChange={(value) => 
                      updatePreferences({ theme: value as 'light' | 'dark' | 'system' })
                    }>
                  
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select theme" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Compact Mode</Label>
                    <p className="text-sm text-muted-foreground">
                      Use a more compact layout
                    </p>
                  </div>
                  <Switch
                    checked={preferences.compact_mode}
                    onCheckedChange={(checked) => 
                      updatePreferences({ compact_mode: checked })
                    }
                  />
                </div>
              </div>

              <Button onClick={handleSaveAppearance}>
                Save Appearance Settings
              </Button>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
