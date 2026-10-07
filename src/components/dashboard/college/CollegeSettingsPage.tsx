import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Lock, Bell, Settings as SettingsIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const CollegeSettingsPage = () => {
  const { toast } = useToast();
  
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    pushNotifications: true,
    taskReminders: true,
    weeklyDigest: false,
  });
  
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Load user preferences
        const { data: userPrefs } = await supabase
          .from('user_preferences')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (userPrefs) {
          setPreferences({
            emailNotifications: userPrefs.email_notifications ?? true,
            pushNotifications: userPrefs.push_notifications ?? true,
            taskReminders: userPrefs.task_reminders ?? true,
            weeklyDigest: userPrefs.weekly_digest ?? false,
          });
        }
      } catch (error) {
        console.error('Error loading preferences:', error);
        toast({
          title: "Error loading settings",
          description: "Please try again later.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, [toast]);

  const handlePasswordChange = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure both passwords are the same.",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword
      });

      if (error) throw error;

      toast({
        title: "Password updated successfully",
        description: "Your password has been changed.",
      });

      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (error) {
      console.error('Error updating password:', error);
      toast({
        title: "Error updating password",
        description: "Please try again later.",
        variant: "destructive",
      });
    }
  };

  const handleSavePreferences = async (newPreferences: typeof preferences) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check if preferences exist
      const { data: existingPrefs } = await supabase
        .from('user_preferences')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingPrefs) {
        // Update existing preferences
        const { error } = await supabase
          .from('user_preferences')
          .update({
            email_notifications: newPreferences.emailNotifications,
            push_notifications: newPreferences.pushNotifications,
            task_reminders: newPreferences.taskReminders,
            weekly_digest: newPreferences.weeklyDigest,
          })
          .eq('user_id', user.id);

        if (error) throw error;
      } else {
        // Create new preferences
        const { error } = await supabase
          .from('user_preferences')
          .insert({
            user_id: user.id,
            email_notifications: newPreferences.emailNotifications,
            push_notifications: newPreferences.pushNotifications,
            task_reminders: newPreferences.taskReminders,
            weekly_digest: newPreferences.weeklyDigest,
          });

        if (error) throw error;
      }

      toast({
        title: "Preferences updated",
        description: "Your settings have been saved.",
      });
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast({
        title: "Error saving preferences",
        description: "Please try again later.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Password Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Lock className="h-5 w-5" />
            <span>Password & Security</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="current_password">Current Password</Label>
            <Input
              id="current_password"
              type="password"
              value={passwordData.currentPassword}
              onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
              placeholder="Enter current password"
            />
          </div>
          <div>
            <Label htmlFor="new_password">New Password</Label>
            <Input
              id="new_password"
              type="password"
              value={passwordData.newPassword}
              onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
              placeholder="Enter new password"
            />
          </div>
          <div>
            <Label htmlFor="confirm_password">Confirm New Password</Label>
            <Input
              id="confirm_password"
              type="password"
              value={passwordData.confirmPassword}
              onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
              placeholder="Confirm new password"
            />
          </div>
          <Button onClick={handlePasswordChange} variant="outline">
            Update Password
          </Button>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Bell className="h-5 w-5" />
            <span>Notification Preferences</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Email Notifications</h4>
              <p className="text-sm text-gray-600">Receive notifications via email</p>
            </div>
            <Switch
              checked={preferences.emailNotifications}
              onCheckedChange={(checked) => {
                setPreferences({ ...preferences, emailNotifications: checked });
                handleSavePreferences({ ...preferences, emailNotifications: checked });
              }}
            />
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Push Notifications</h4>
              <p className="text-sm text-gray-600">Receive push notifications in browser</p>
            </div>
            <Switch
              checked={preferences.pushNotifications}
              onCheckedChange={(checked) => {
                setPreferences({ ...preferences, pushNotifications: checked });
                handleSavePreferences({ ...preferences, pushNotifications: checked });
              }}
            />
          </div>

          <Separator />
          
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Task Reminders</h4>
              <p className="text-sm text-gray-600">Get reminders about pending tasks</p>
            </div>
            <Switch
              checked={preferences.taskReminders}
              onCheckedChange={(checked) => {
                setPreferences({ ...preferences, taskReminders: checked });
                handleSavePreferences({ ...preferences, taskReminders: checked });
              }}
            />
          </div>

          <Separator />
          
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Weekly Digest</h4>
              <p className="text-sm text-gray-600">Receive weekly summary emails</p>
            </div>
            <Switch
              checked={preferences.weeklyDigest}
              onCheckedChange={(checked) => {
                setPreferences({ ...preferences, weeklyDigest: checked });
                handleSavePreferences({ ...preferences, weeklyDigest: checked });
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* System Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <SettingsIcon className="h-5 w-5" />
            <span>System Settings</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium text-gray-900">Account Management</h4>
            <p className="text-sm text-gray-600 mt-1">
              For advanced account settings like data export or account deletion, 
              please contact our support team.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CollegeSettingsPage;