import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface StartupMultiStepWizardProps {
  onComplete: () => void;
}

interface StartupWizardData {
  // Step 1
  companyName: string;
  website: string;
  contactPerson: string;
  email: string;
  contactNumber: string;
  // Step 2
  lookingFor: 'internships' | 'projects' | 'both';
  areasOfInterest: string[];
}

const AREAS_OF_INTEREST = [
  "Frontend Development",
  "Backend Development", 
  "Full Stack Development",
  "Mobile Development",
  "Data Science",
  "Machine Learning",
  "AI Development",
  "DevOps",
  "UI/UX Design",
  "Product Management",
  "Digital Marketing",
  "Content Writing",
  "Graphic Design",
  "Video Editing",
  "Quality Assurance",
  "Business Analysis"
];

export default function StartupMultiStepWizard({ onComplete }: StartupMultiStepWizardProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<StartupWizardData>({
    companyName: "",
    website: "",
    contactPerson: "",
    email: user?.email || "",
    contactNumber: "",
    lookingFor: 'both',
    areasOfInterest: []
  });

  const handleNext = () => {
    if (currentStep === 1) {
      if (!formData.companyName || !formData.contactPerson || !formData.email || !formData.contactNumber) {
        toast.error("Please fill in all required fields");
        return;
      }
    }
    if (currentStep === 2) {
      if (formData.areasOfInterest.length === 0) {
        toast.error("Please select at least one area of interest");
        return;
      }
    }
    setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
  };

  const handleAreaToggle = (area: string) => {
    setFormData(prev => ({
      ...prev,
      areasOfInterest: prev.areasOfInterest.includes(area)
        ? prev.areasOfInterest.filter(a => a !== area)
        : [...prev.areasOfInterest, area]
    }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Create startup profile
      const { error: profileError } = await supabase
        .from('startup_profiles')
        .upsert({
          user_id: user?.id,
          startup_name: formData.companyName,
          domain_industry: formData.areasOfInterest.join(', '),
          talent_needs: formData.areasOfInterest
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

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Basic Information</h2>
        <p className="text-gray-600">Tell us about your startup and contact details</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="companyName">Startup/Company Name *</Label>
          <Input
            id="companyName"
            value={formData.companyName}
            onChange={(e) => setFormData(prev => ({ ...prev, companyName: e.target.value }))}
            placeholder="Enter company name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="website">Website/LinkedIn</Label>
          <Input
            id="website"
            value={formData.website}
            onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
            placeholder="Enter website or LinkedIn URL (optional)"
          />
          <p className="text-sm text-gray-500">Optional but useful for credibility</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactPerson">Contact Person Name *</Label>
          <Input
            id="contactPerson"
            value={formData.contactPerson}
            onChange={(e) => setFormData(prev => ({ ...prev, contactPerson: e.target.value }))}
            placeholder="Enter contact person name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Official Email *</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
            placeholder="Enter official email"
          />
          <p className="text-sm text-gray-500">From signup, editable if needed</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactNumber">Contact Number *</Label>
          <Input
            id="contactNumber"
            type="tel"
            value={formData.contactNumber}
            onChange={(e) => setFormData(prev => ({ ...prev, contactNumber: e.target.value }))}
            placeholder="Enter contact number"
          />
        </div>
      </div>

      <Button onClick={handleNext} className="w-full">
        Next Step <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Hiring Preferences</h2>
        <p className="text-gray-600">What type of talent are you looking for?</p>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <Label>Looking for:</Label>
          <RadioGroup
            value={formData.lookingFor}
            onValueChange={(value: 'internships' | 'projects' | 'both') => 
              setFormData(prev => ({ ...prev, lookingFor: value }))
            }
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="internships" id="internships" />
              <Label htmlFor="internships">Internships</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="projects" id="projects" />
              <Label htmlFor="projects">Proof-of-Work projects</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="both" id="both" />
              <Label htmlFor="both">Both</Label>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-3">
          <Label>Areas of interest (multi-select) *</Label>
          <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
            {AREAS_OF_INTEREST.map(area => (
              <div key={area} className="flex items-center space-x-2">
                <Checkbox
                  id={area}
                  checked={formData.areasOfInterest.includes(area)}
                  onCheckedChange={() => handleAreaToggle(area)}
                />
                <Label htmlFor={area} className="text-sm">{area}</Label>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500">
            Select all areas where you might need talent
          </p>
        </div>
      </div>

      <div className="flex space-x-4">
        <Button variant="outline" onClick={handleBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button onClick={handleNext} className="flex-1">
          Next Step <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Confirmation</h2>
        <p className="text-gray-600">Review your details before submitting</p>
      </div>

      <div className="bg-gray-50 p-6 rounded-lg space-y-4">
        <div>
          <h3 className="font-semibold text-gray-900">Company Information</h3>
          <div className="mt-2 space-y-1 text-sm text-gray-600">
            <p><span className="font-medium">Name:</span> {formData.companyName}</p>
            {formData.website && <p><span className="font-medium">Website:</span> {formData.website}</p>}
            <p><span className="font-medium">Contact Person:</span> {formData.contactPerson}</p>
            <p><span className="font-medium">Email:</span> {formData.email}</p>
            <p><span className="font-medium">Contact Number:</span> {formData.contactNumber}</p>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-gray-900">Hiring Preferences</h3>
          <div className="mt-2 space-y-1 text-sm text-gray-600">
            <p><span className="font-medium">Looking for:</span> {formData.lookingFor}</p>
            <p><span className="font-medium">Areas of Interest:</span></p>
            <div className="ml-4 mt-1">
              {formData.areasOfInterest.map(area => (
                <span key={area} className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full mr-2 mb-1">
                  {area}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex space-x-4">
        <Button variant="outline" onClick={handleBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button onClick={handleSubmit} disabled={loading} className="flex-1">
          {loading ? "Creating Dashboard..." : "Create Startup Dashboard"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-pink-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex space-x-2">
              {[1, 2, 3].map((step) => (
                <div
                  key={step}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    step === currentStep
                      ? 'bg-primary text-primary-foreground'
                      : step < currentStep
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {step}
                </div>
              ))}
            </div>
            <div className="text-sm text-gray-500">
              Step {currentStep} of 3
            </div>
          </div>
          <CardTitle className="text-center text-2xl font-bold">
            Startup Onboarding Wizard
          </CardTitle>
        </CardHeader>

        <CardContent>
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
        </CardContent>
      </Card>
    </div>
  );
}