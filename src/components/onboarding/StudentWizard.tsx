import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface StudentWizardProps {
  onComplete: () => void;
}

interface StudentWizardData {
  fullName: string;
  branch: string;
  yearOfStudy: string;
  keyInterests: string[];
  preferredSkills: string[];
  careerGoals: string;
}

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

export default function StudentWizard({ onComplete }: StudentWizardProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<StudentWizardData>({
    fullName: "",
    branch: "",
    yearOfStudy: "",
    keyInterests: [],
    preferredSkills: [],
    careerGoals: ""
  });

  const handleInterestToggle = (interest: string) => {
    setFormData(prev => ({
      ...prev,
      keyInterests: prev.keyInterests.includes(interest)
        ? prev.keyInterests.filter(i => i !== interest)
        : [...prev.keyInterests, interest]
    }));
  };

  const handleSkillToggle = (skill: string) => {
    setFormData(prev => ({
      ...prev,
      preferredSkills: prev.preferredSkills.includes(skill)
        ? prev.preferredSkills.filter(s => s !== skill)
        : [...prev.preferredSkills, skill]
    }));
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (!formData.fullName || !formData.branch || !formData.yearOfStudy) {
        toast.error("Please fill in all required fields");
        return;
      }
    }
    setCurrentStep(2);
  };

  const handleSubmit = async () => {
    if (formData.keyInterests.length === 0) {
      toast.error("Please select at least one interest");
      return;
    }

    setLoading(true);
    try {
      // Create or update student profile
      const { error: profileError } = await supabase
        .from('student_profiles')
        .upsert({
          user_id: user?.id,
          full_name: formData.fullName,
          email: user?.email || '',
          branch: formData.branch,
          year_of_study: formData.yearOfStudy,
          key_interests: formData.keyInterests,
          preferred_skills: formData.preferredSkills,
          career_goals: formData.careerGoals,
          profile_completed: true
        }, {
          onConflict: 'user_id'
        });

      if (profileError) throw profileError;

      toast.success("Profile updated successfully! 🎓");
      onComplete();
    } catch (error) {
      console.error('Error completing wizard:', error);
      toast.error("Failed to complete setup. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center justify-between mb-4">
            <div className="flex space-x-2">
              <div className={`w-3 h-3 rounded-full ${currentStep >= 1 ? 'bg-primary' : 'bg-gray-200'}`} />
              <div className={`w-3 h-3 rounded-full ${currentStep >= 2 ? 'bg-primary' : 'bg-gray-200'}`} />
            </div>
            <span className="text-sm text-muted-foreground">Step {currentStep} of 2</span>
          </div>
          
          {currentStep === 1 ? (
            <CardTitle className="text-center text-2xl font-bold">
              Your job magnet is ready. Take a second to tell us about you.
            </CardTitle>
          ) : (
            <CardTitle className="text-center text-2xl font-bold">
              Almost there! Let's personalise your tasks.
            </CardTitle>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {currentStep === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  value={formData.fullName}
                  onChange={(e) => setFormData(prev => ({ ...prev, fullName: e.target.value }))}
                  placeholder="Enter your full name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="branch">Branch *</Label>
                <Select value={formData.branch} onValueChange={(value) => setFormData(prev => ({ ...prev, branch: value }))}>
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

              <div className="space-y-2">
                <Label htmlFor="year">Year of Study *</Label>
                <Select value={formData.yearOfStudy} onValueChange={(value) => setFormData(prev => ({ ...prev, yearOfStudy: value }))}>
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

              <div className="space-y-3">
                <Label>Key Interests</Label>
                <div className="grid grid-cols-2 gap-2">
                  {INTERESTS.map(interest => (
                    <div key={interest} className="flex items-center space-x-2">
                      <Checkbox
                        id={interest}
                        checked={formData.keyInterests.includes(interest)}
                        onCheckedChange={() => handleInterestToggle(interest)}
                      />
                      <Label htmlFor={interest} className="text-sm">{interest}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleNext} className="flex items-center space-x-2">
                  <span>Next</span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}

          {currentStep === 2 && (
            <>
              <div className="space-y-3">
                <Label>Preferred Skills</Label>
                <div className="grid grid-cols-3 gap-2">
                  {SKILLS.map(skill => (
                    <div key={skill} className="flex items-center space-x-2">
                      <Checkbox
                        id={skill}
                        checked={formData.preferredSkills.includes(skill)}
                        onCheckedChange={() => handleSkillToggle(skill)}
                      />
                      <Label htmlFor={skill} className="text-sm">{skill}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="careerGoals">Career Goals</Label>
                <Textarea
                  id="careerGoals"
                  value={formData.careerGoals}
                  onChange={(e) => setFormData(prev => ({ ...prev, careerGoals: e.target.value }))}
                  placeholder="Tell us about your career aspirations..."
                  rows={4}
                />
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(1)} className="flex items-center space-x-2">
                  <ChevronLeft className="h-4 w-4" />
                  <span>Back</span>
                </Button>
                <Button onClick={handleSubmit} disabled={loading} className="flex items-center space-x-2">
                  {loading ? "Setting up..." : "Complete Setup"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}