import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { User, Lock, Bell, Eye, Save } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import ProfilePhotoModal from "../ProfilePhotoModal";
import { getInitials } from "@/lib/utils";

interface StudentSettingsPageProps {
  refreshProfile?: () => void;
}

// Options from signup wizard
const BRANCHES = [
  "Computer Science", "Information Technology", "Electronics", "Mechanical", 
  "Civil", "Electrical", "Chemical", "Biotechnology", "Other"
];

const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "Graduate"];

const INTERESTS = [
  "Web Development", "Mobile Development", "Data Science", "Machine Learning", 
  "Cybersecurity", "Cloud Computing", "DevOps", "UI/UX Design", "Game Development", 
  "Blockchain", "IoT", "Robotics"
];

const SKILLS = [
  "JavaScript", "Python", "Java", "React", "Node.js", "SQL", "HTML/CSS", 
  "Git", "Docker", "AWS", "MongoDB", "TypeScript", "C++", "PHP", "Angular", "Vue.js"
];

const StudentSettingsPage = ({ refreshProfile }: StudentSettingsPageProps) => {
  const { profile, loading } = useStudentProfile();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    full_name: profile?.full_name || '',
    email: profile?.email || '',
    bio: '',
    branch: profile?.branch || '',
    year_of_study: profile?.year_of_study || '',
    key_interests: profile?.key_interests || [] as string[],
    preferred_skills: profile?.preferred_skills || [] as string[],
    career_goals: profile?.career_goals || '',
    skills: [] as string[],
  });

  // Load portfolio data including bio and user preferences
  useEffect(() => {
    const loadData = async () => {
      if (profile?.id) {
        // Load portfolio data
        const { data: portfolioData } = await supabase
          .from('student_portfolios')
          .select('bio, skills, is_public')
          .eq('student_id', profile.id)
          .maybeSingle();

        if (portfolioData) {
          setFormData(prev => ({
            ...prev,
            bio: portfolioData.bio || '',
            skills: portfolioData.skills || [],
          }));
          setPreferences(prev => ({
            ...prev,
            portfolioPublic: portfolioData.is_public ?? true,
          }));
        }

        // Load user preferences
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: userPrefs } = await supabase
            .from('user_preferences')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

          if (userPrefs) {
            setPreferences({
              emailNotifications: userPrefs.email_notifications ?? true,
              pushNotifications: userPrefs.push_notifications ?? true,
              portfolioPublic: portfolioData?.is_public ?? userPrefs.portfolio_public ?? true,
              showProgressToOthers: userPrefs.show_progress_to_others ?? false,
            });
          }
        }
      }
    };

    loadData();
  }, [profile?.id]);

  // Update form data when profile changes
  useEffect(() => {
    if (profile) {
      setFormData(prev => ({
        ...prev,
        full_name: profile.full_name || '',
        email: profile.email || '',
        branch: profile.branch || '',
        year_of_study: profile.year_of_study || '',
        key_interests: profile.key_interests || [],
        preferred_skills: profile.preferred_skills || [],
        career_goals: profile.career_goals || '',
      }));
    }
  }, [profile]);
  
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    pushNotifications: true,
    portfolioPublic: true,
    showProgressToOthers: false,
  });
  
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [saving, setSaving] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState(profile?.profile_photo_url || null);

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


  const handleProfileUpdate = async () => {
    setSaving(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Update student profile with all fields
      const { error: profileError } = await supabase
        .from('student_profiles')
        .update({
          full_name: formData.full_name,
          branch: formData.branch,
          year_of_study: formData.year_of_study,
          key_interests: formData.key_interests,
          preferred_skills: formData.preferred_skills,
          career_goals: formData.career_goals,
          profile_completed: true,
        })
        .eq('user_id', user.id);

      if (profileError) throw profileError;

      // Check if portfolio exists, if not create it
      const { data: existingPortfolio } = await supabase
        .from('student_portfolios')
        .select('id')
        .eq('student_id', profile?.id)
        .maybeSingle();

      if (existingPortfolio) {
        // Update existing portfolio
        const { error: portfolioError } = await supabase
          .from('student_portfolios')
          .update({
            bio: formData.bio,
            skills: formData.skills,
          })
          .eq('student_id', profile?.id);

        if (portfolioError) throw portfolioError;
      } else {
        // Create new portfolio
        const { error: portfolioError } = await supabase
          .from('student_portfolios')
          .insert({
            student_id: profile?.id,
            bio: formData.bio,
            skills: formData.skills,
          });

        if (portfolioError) throw portfolioError;
      }

      toast({
        title: "Profile updated successfully",
        description: "Your changes have been saved.",
      });

      // Refresh profile if callback provided
      if (refreshProfile) {
        refreshProfile();
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: "Error updating profile",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

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
            show_progress_to_others: newPreferences.showProgressToOthers,
            portfolio_public: newPreferences.portfolioPublic,
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
            show_progress_to_others: newPreferences.showProgressToOthers,
            portfolio_public: newPreferences.portfolioPublic,
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

  const handleSavePortfolioPrivacy = async (isPublic: boolean) => {
    try {
      // upsert, not update: a student who never opened the portfolio has no row,
      // and update() on zero rows succeeds silently - the toggle said "public"
      // while recruiters still could not find them (student_is_discoverable
      // requires this row).
      const { error } = await supabase
        .from('student_portfolios')
        .upsert({ student_id: profile?.id, is_public: isPublic } as never, { onConflict: 'student_id' });

      if (error) throw error;

      // Save to user preferences as well
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await handleSavePreferences({ ...preferences, portfolioPublic: isPublic });
      }
    } catch (error) {
      console.error('Error updating portfolio privacy:', error);
      toast({
        title: "Error updating privacy settings",
        description: "Please try again later.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Profile Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <User className="h-5 w-5" />
            <span>Profile Information</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Profile Photo */}
          <div className="flex items-center space-x-6">
            <Avatar 
              className="h-20 w-20 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setIsPhotoModalOpen(true)}
            >
              <AvatarImage src={currentPhotoUrl || undefined} alt={profile?.full_name} />
              <AvatarFallback className="bg-orange-100 text-orange-700 text-xl">
                {getInitials(profile?.full_name || 'Student')}
              </AvatarFallback>
            </Avatar>
            <div>
              <Button 
                variant="outline" 
                className="flex items-center space-x-2"
                onClick={() => setIsPhotoModalOpen(true)}
              >
                <span>Change Photo</span>
              </Button>
              <p className="text-sm text-gray-500 mt-1">JPG, PNG or GIF. Max size 2MB.</p>
            </div>
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="full_name">Full Name</Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="Enter your full name"
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={formData.email}
                disabled
                className="bg-gray-50"
                placeholder="Email cannot be changed"
              />
            </div>
          </div>

          {/* Branch */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="branch">Branch</Label>
              <Select value={formData.branch} onValueChange={(value) => setFormData({ ...formData, branch: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select your branch" />
                </SelectTrigger>
                <SelectContent>
                  {BRANCHES.map(branch => (
                    <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="year_of_study">Year of Study</Label>
              <Select value={formData.year_of_study} onValueChange={(value) => setFormData({ ...formData, year_of_study: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select your year" />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map(year => (
                    <SelectItem key={year} value={year}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Key Interests */}
          <div>
            <Label>Key Interests</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
              {INTERESTS.map(interest => (
                <div key={interest} className="flex items-center space-x-2">
                  <Checkbox
                    id={interest}
                    checked={formData.key_interests.includes(interest)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFormData({ ...formData, key_interests: [...formData.key_interests, interest] });
                      } else {
                        setFormData({ ...formData, key_interests: formData.key_interests.filter(i => i !== interest) });
                      }
                    }}
                  />
                  <Label htmlFor={interest} className="text-sm">{interest}</Label>
                </div>
              ))}
            </div>
          </div>

          {/* Preferred Skills */}
          <div>
            <Label>Preferred Skills</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {SKILLS.map(skill => (
                <div key={skill} className="flex items-center space-x-2">
                  <Checkbox
                    id={skill}
                    checked={formData.preferred_skills.includes(skill)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFormData({ ...formData, preferred_skills: [...formData.preferred_skills, skill] });
                      } else {
                        setFormData({ ...formData, preferred_skills: formData.preferred_skills.filter(s => s !== skill) });
                      }
                    }}
                  />
                  <Label htmlFor={skill} className="text-sm">{skill}</Label>
                </div>
              ))}
            </div>
          </div>

          {/* Career Goals */}
          <div>
            <Label htmlFor="career_goals">Career Goals</Label>
            <Textarea
              id="career_goals"
              value={formData.career_goals}
              onChange={(e) => setFormData({ ...formData, career_goals: e.target.value })}
              placeholder="Tell us about your career aspirations..."
              className="min-h-[100px]"
            />
          </div>

          {/* Bio */}
          <div>
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              placeholder="Tell us about yourself..."
              className="min-h-[100px]"
            />
          </div>

          {/* Portfolio Skills */}
          <div>
            <Label>Portfolio Skills</Label>
            <p className="text-sm text-gray-500 mb-2">These skills will be displayed on your public portfolio</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {SKILLS.map(skill => (
                <div key={skill} className="flex items-center space-x-2">
                  <Checkbox
                    id={`portfolio-${skill}`}
                    checked={formData.skills.includes(skill)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFormData({ ...formData, skills: [...formData.skills, skill] });
                      } else {
                        setFormData({ ...formData, skills: formData.skills.filter(s => s !== skill) });
                      }
                    }}
                  />
                  <Label htmlFor={`portfolio-${skill}`} className="text-sm">{skill}</Label>
                </div>
              ))}
            </div>
          </div>

          <Button onClick={handleProfileUpdate} disabled={saving} className="bg-orange-600 hover:bg-orange-700">
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

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
        </CardContent>
      </Card>

      {/* Privacy Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Eye className="h-5 w-5" />
            <span>Privacy Settings</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Public Portfolio</h4>
              <p className="text-sm text-gray-600">Make your portfolio visible to others</p>
            </div>
            <Switch
              checked={preferences.portfolioPublic}
              onCheckedChange={(checked) => {
                setPreferences({ ...preferences, portfolioPublic: checked });
                handleSavePortfolioPrivacy(checked);
              }}
            />
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Show Progress to Others</h4>
              <p className="text-sm text-gray-600">Allow others to see your progress and stats</p>
            </div>
            <Switch
              checked={preferences.showProgressToOthers}
              onCheckedChange={(checked) => {
                setPreferences({ ...preferences, showProgressToOthers: checked });
                handleSavePreferences({ ...preferences, showProgressToOthers: checked });
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Account Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 border border-red-200 rounded-lg bg-red-50">
            <h4 className="font-medium text-red-800 mb-2">Delete Account</h4>
            <p className="text-sm text-red-600 mb-4">
              Once you delete your account, there is no going back. Please be certain.
            </p>
            <Button variant="destructive">
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Profile Photo Modal */}
      <ProfilePhotoModal
        isOpen={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        currentPhotoUrl={currentPhotoUrl}
        userName={profile?.full_name || 'Student'}
        userId={profile?.id || ''}
        onPhotoUpdate={(newUrl) => {
          setCurrentPhotoUrl(newUrl);
          // Refresh the profile data in the parent component to update the header
          if (refreshProfile) {
            refreshProfile();
          }
        }}
      />
    </div>
  );
};

export default StudentSettingsPage;