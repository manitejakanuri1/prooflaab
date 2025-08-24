import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface CollegeWizardProps {
  onComplete: () => void;
}

interface CollegeWizardData {
  collegeName: string;
  location: string;
  branchesOffered: string[];
  studentStrength: number;
}

const BRANCHES = [
  "Computer Science", "Information Technology", "Electronics", "Mechanical", 
  "Civil", "Electrical", "Chemical", "Biotechnology", "Aerospace", "Other"
];

export default function CollegeWizard({ onComplete }: CollegeWizardProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<CollegeWizardData>({
    collegeName: "",
    location: "",
    branchesOffered: [],
    studentStrength: 0
  });

  const handleBranchToggle = (branch: string) => {
    setFormData(prev => ({
      ...prev,
      branchesOffered: prev.branchesOffered.includes(branch)
        ? prev.branchesOffered.filter(b => b !== branch)
        : [...prev.branchesOffered, branch]
    }));
  };

  const handleSubmit = async () => {
    if (!formData.collegeName || !formData.location || formData.branchesOffered.length === 0) {
      toast.error("Please fill in all required fields");
      return;
    }

    setLoading(true);
    try {
      // Create college profile
      const { error: profileError } = await supabase
        .from('college_profiles')
        .upsert({
          user_id: user?.id,
          college_name: formData.collegeName,
          location: formData.location,
          branches_offered: formData.branchesOffered,
          student_strength: formData.studentStrength
        });

      if (profileError) throw profileError;

      // Mark wizard as completed
      const { error: roleError } = await supabase
        .from('user_roles')
        .update({ has_completed_wizard: true })
        .eq('user_id', user?.id);

      if (roleError) throw roleError;

      toast.success("Welcome to ProofLabAI! 🎓");
      onComplete();
    } catch (error) {
      console.error('Error completing wizard:', error);
      toast.error("Failed to complete setup. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">
            Bring your students into ProofLabAI with a single step.
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="collegeName">College Name *</Label>
            <Input
              id="collegeName"
              value={formData.collegeName}
              onChange={(e) => setFormData(prev => ({ ...prev, collegeName: e.target.value }))}
              placeholder="Enter college name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location *</Label>
            <Input
              id="location"
              value={formData.location}
              onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
              placeholder="Enter college location"
            />
          </div>

          <div className="space-y-3">
            <Label>Branches Offered *</Label>
            <div className="grid grid-cols-2 gap-2">
              {BRANCHES.map(branch => (
                <div key={branch} className="flex items-center space-x-2">
                  <Checkbox
                    id={branch}
                    checked={formData.branchesOffered.includes(branch)}
                    onCheckedChange={() => handleBranchToggle(branch)}
                  />
                  <Label htmlFor={branch} className="text-sm">{branch}</Label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="studentStrength">Student Strength (Approximate)</Label>
            <Input
              id="studentStrength"
              type="number"
              value={formData.studentStrength || ""}
              onChange={(e) => setFormData(prev => ({ ...prev, studentStrength: parseInt(e.target.value) || 0 }))}
              placeholder="Enter approximate number of students"
            />
          </div>

          <Button 
            onClick={handleSubmit} 
            disabled={loading} 
            className="w-full"
          >
            {loading ? "Setting up..." : "Complete Setup"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}