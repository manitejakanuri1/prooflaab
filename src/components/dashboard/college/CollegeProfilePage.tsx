import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { User, Save, Building } from "lucide-react";
import ProfilePhotoModalUniversal from "../ProfilePhotoModalUniversal";

const CollegeProfilePage = () => {
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    college_name: '',
    location: '',
    student_strength: '',
    branches_offered: [] as string[],
  });

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  useEffect(() => {
    const loadCollegeProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        setCurrentUserId(user.id);

        // Load college profile
        const { data: collegeProfile } = await supabase
          .from('college_profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (collegeProfile) {
          setFormData({
            college_name: collegeProfile.college_name || '',
            location: collegeProfile.location || '',
            student_strength: collegeProfile.student_strength?.toString() || '',
            branches_offered: collegeProfile.branches_offered || [],
          });
          setCurrentPhotoUrl(collegeProfile.profile_photo_url);
        }

        // Load college basic info from colleges table
        const { data: collegeData } = await supabase
          .from('colleges')
          .select('name')
          .eq('user_id', user.id)
          .maybeSingle();

        if (collegeData && !collegeProfile?.college_name) {
          setFormData(prev => ({
            ...prev,
            college_name: collegeData.name
          }));
        }
      } catch (error) {
        console.error('Error loading college profile:', error);
        toast({
          title: "Error loading profile",
          description: "Please try again later.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    loadCollegeProfile();
  }, [toast]);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleProfileUpdate = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if profile exists
      const { data: existingProfile } = await supabase
        .from('college_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      const profileData = {
        college_name: formData.college_name,
        location: formData.location,
        student_strength: formData.student_strength ? parseInt(formData.student_strength) : null,
        branches_offered: formData.branches_offered,
      };

      if (existingProfile) {
        // Update existing profile
        const { error } = await supabase
          .from('college_profiles')
          .update(profileData)
          .eq('user_id', user.id);

        if (error) throw error;
      } else {
        // Create new profile
        const { error } = await supabase
          .from('college_profiles')
          .insert({
            user_id: user.id,
            ...profileData,
          });

        if (error) throw error;
      }

      toast({
        title: "Profile updated successfully",
        description: "Your changes have been saved.",
      });
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

  const handleBranchesChange = (value: string) => {
    const branches = value.split(',').map(branch => branch.trim()).filter(Boolean);
    setFormData({ ...formData, branches_offered: branches });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>College Profile</CardTitle>
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Building className="h-5 w-5" />
            <span>College Profile</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Profile Photo */}
          <div className="flex items-center space-x-6">
            <Avatar 
              className="h-20 w-20 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setIsPhotoModalOpen(true)}
            >
              <AvatarImage src={currentPhotoUrl || undefined} alt={formData.college_name} />
              <AvatarFallback className="bg-orange-100 text-orange-700 text-xl">
                {getInitials(formData.college_name || 'College')}
              </AvatarFallback>
            </Avatar>
            <div>
              <Button 
                variant="outline" 
                className="flex items-center space-x-2"
                onClick={() => setIsPhotoModalOpen(true)}
              >
                <span>Change Logo</span>
              </Button>
              <p className="text-sm text-gray-500 mt-1">JPG, PNG or GIF. Max size 2MB.</p>
            </div>
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="college_name">College Name</Label>
              <Input
                id="college_name"
                value={formData.college_name}
                onChange={(e) => setFormData({ ...formData, college_name: e.target.value })}
                placeholder="Enter college name"
              />
            </div>
            <div>
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="Enter location"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="student_strength">Student Strength</Label>
            <Input
              id="student_strength"
              type="number"
              value={formData.student_strength}
              onChange={(e) => setFormData({ ...formData, student_strength: e.target.value })}
              placeholder="Number of students"
            />
          </div>

          {/* Branches */}
          <div>
            <Label htmlFor="branches">Branches Offered</Label>
            <Textarea
              id="branches"
              value={formData.branches_offered.join(', ')}
              onChange={(e) => handleBranchesChange(e.target.value)}
              placeholder="Computer Science, Electrical Engineering, Mechanical Engineering (comma separated)"
              className="min-h-[80px]"
            />
            <p className="text-sm text-gray-500 mt-1">Separate branches with commas</p>
          </div>

          <Button onClick={handleProfileUpdate} disabled={saving} className="bg-orange-600 hover:bg-orange-700">
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      <ProfilePhotoModalUniversal
        isOpen={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        currentPhotoUrl={currentPhotoUrl}
        userName={formData.college_name || 'College'}
        userId={currentUserId}
        userType="college"
        onPhotoUpdate={(url) => {
          setCurrentPhotoUrl(url);
          setIsPhotoModalOpen(false);
        }}
      />
    </div>
  );
};

export default CollegeProfilePage;