import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface StartupWizardProps {
  onComplete: () => void;
}

interface StartupWizardData {
  startupName: string;
  domainIndustry: string;
  talentNeeds: string[];
}

const TALENT_SKILLS = [
  "Frontend Development", "Backend Development", "Full Stack Development", 
  "Mobile Development", "Data Science", "Machine Learning", "DevOps", 
  "UI/UX Design", "Product Management", "Digital Marketing", "Content Writing", 
  "Graphic Design", "Video Editing", "Quality Assurance", "Business Analysis"
];

export default function StartupWizard({ onComplete }: StartupWizardProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<StartupWizardData>({
    startupName: "",
    domainIndustry: "",
    talentNeeds: []
  });

  const handleTalentToggle = (skill: string) => {
    setFormData(prev => ({
      ...prev,
      talentNeeds: prev.talentNeeds.includes(skill)
        ? prev.talentNeeds.filter(t => t !== skill)
        : [...prev.talentNeeds, skill]
    }));
  };

  const handleSubmit = async () => {
    if (!formData.startupName || !formData.domainIndustry || formData.talentNeeds.length === 0) {
      toast.error("Please fill in all required fields");
      return;
    }

    setLoading(true);
    try {
      // Create startup profile
      const { error: profileError } = await supabase
        .from('startup_profiles')
        .upsert({
          user_id: user?.id,
          startup_name: formData.startupName,
          domain_industry: formData.domainIndustry,
          talent_needs: formData.talentNeeds
        });

      if (profileError) throw profileError;

      // Mark wizard as completed
      const { error: roleError } = await supabase
        .from('user_roles')
        .update({ has_completed_wizard: true })
        .eq('user_id', user?.id);

      if (roleError) throw roleError;

      toast.success("Welcome to ProofLabAI! 🚀");
      onComplete();
    } catch (error) {
      console.error('Error completing wizard:', error);
      toast.error("Failed to complete setup. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">
            Find proof-of-work ready talent for your startup.
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="startupName">Startup Name *</Label>
            <Input
              id="startupName"
              value={formData.startupName}
              onChange={(e) => setFormData(prev => ({ ...prev, startupName: e.target.value }))}
              placeholder="Enter your startup name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="domainIndustry">Domain/Industry *</Label>
            <Input
              id="domainIndustry"
              value={formData.domainIndustry}
              onChange={(e) => setFormData(prev => ({ ...prev, domainIndustry: e.target.value }))}
              placeholder="e.g., FinTech, AI/ML, E-commerce"
            />
          </div>

          <div className="space-y-3">
            <Label>Talent Needs (Skills) *</Label>
            <div className="grid grid-cols-2 gap-2">
              {TALENT_SKILLS.map(skill => (
                <div key={skill} className="flex items-center space-x-2">
                  <Checkbox
                    id={skill}
                    checked={formData.talentNeeds.includes(skill)}
                    onCheckedChange={() => handleTalentToggle(skill)}
                  />
                  <Label htmlFor={skill} className="text-sm">{skill}</Label>
                </div>
              ))}
            </div>
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