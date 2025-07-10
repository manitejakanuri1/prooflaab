
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    profilePhotoUrl: "",
    linkedinUrl: "",
    githubUrl: "",
    isPublic: true,
  });

  useEffect(() => {
    if (isOpen && user) {
      fetchUserProfile();
    }
  }, [isOpen, user]);

  const fetchUserProfile = async () => {
    try {
      // Fetch student profile
      const { data: profile, error: profileError } = await supabase
        .from('student_profiles')
        .select('*')
        .eq('user_id', user?.id)
        .single();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        return;
      }

      // Fetch portfolio data
      const { data: portfolio, error: portfolioError } = await supabase
        .from('student_portfolios')
        .select('is_public')
        .eq('student_id', profile.id)
        .maybeSingle();

      if (portfolioError) {
        console.error('Error fetching portfolio:', portfolioError);
      }

      setFormData({
        fullName: profile.full_name || "",
        email: profile.email || "",
        profilePhotoUrl: profile.profile_photo_url || "",
        linkedinUrl: "", // These fields don't exist in current schema
        githubUrl: "",   // These fields don't exist in current schema
        isPublic: portfolio?.is_public ?? true,
      });
    } catch (error) {
      console.error('Error fetching user profile:', error);
      toast({
        title: "Error",
        description: "Failed to load profile data",
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Update student profile
      const { error: profileError } = await supabase
        .from('student_profiles')
        .update({
          full_name: formData.fullName,
          profile_photo_url: formData.profilePhotoUrl,
        })
        .eq('user_id', user.id);

      if (profileError) {
        throw profileError;
      }

      // Get student profile ID for portfolio update
      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (profile) {
        // Update or create portfolio
        const { error: portfolioError } = await supabase
          .from('student_portfolios')
          .upsert({
            student_id: profile.id,
            is_public: formData.isPublic,
          });

        if (portfolioError) {
          throw portfolioError;
        }
      }

      toast({
        title: "Success",
        description: "Settings updated successfully",
      });
      onClose();
    } catch (error) {
      console.error('Error updating settings:', error);
      toast({
        title: "Error",
        description: "Failed to update settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Account Settings</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              value={formData.fullName}
              onChange={(e) => handleInputChange('fullName', e.target.value)}
              placeholder="Enter your full name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              value={formData.email}
              disabled
              className="bg-gray-50"
              placeholder="Email from authentication"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profilePhoto">Profile Photo URL</Label>
            <Input
              id="profilePhoto"
              value={formData.profilePhotoUrl}
              onChange={(e) => handleInputChange('profilePhotoUrl', e.target.value)}
              placeholder="https://example.com/photo.jpg (optional)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="linkedin">LinkedIn URL</Label>
            <Input
              id="linkedin"
              value={formData.linkedinUrl}
              onChange={(e) => handleInputChange('linkedinUrl', e.target.value)}
              placeholder="https://linkedin.com/in/username (optional)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="github">GitHub URL</Label>
            <Input
              id="github"
              value={formData.githubUrl}
              onChange={(e) => handleInputChange('githubUrl', e.target.value)}
              placeholder="https://github.com/username (optional)"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="privacy">Portfolio Privacy</Label>
              <p className="text-sm text-gray-500">Make my portfolio public</p>
            </div>
            <Switch
              id="privacy"
              checked={formData.isPublic}
              onCheckedChange={(checked) => handleInputChange('isPublic', checked)}
            />
          </div>
        </div>

        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
