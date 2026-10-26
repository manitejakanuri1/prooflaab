import { BrandFrame } from "@/components/auth/AccessShell";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
// Lucide React icons for College Multi-Step Wizard
import { ArrowLeft, ArrowRight, Upload } from "lucide-react";

interface CollegeMultiStepWizardProps {
  onComplete: () => void;
}

interface CollegeWizardData {
  // Step 1
  collegeName: string;
  location: string;
  contactPerson: string;
  email: string;
  contactNumber: string;
}

export default function CollegeMultiStepWizard({ onComplete }: CollegeMultiStepWizardProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<CollegeWizardData>({
    collegeName: "",
    location: "",
    contactPerson: "",
    email: user?.email || "",
    contactNumber: ""
  });

  const handleNext = () => {
    if (currentStep === 1) {
      if (!formData.collegeName || !formData.location || !formData.contactPerson || !formData.email) {
        toast.error("Please fill in all required fields");
        return;
      }
    }
    setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
  };

  // ponytail: wizard CSV upload cut — it silently discarded the file. The
  // working uploader lives in TpoImportStudents (create-student-users).

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Create college profile
      const { error: profileError } = await supabase
        .from('college_profiles')
        .upsert({
          user_id: user?.id,
          college_name: formData.collegeName,
          location: formData.location,
        });

      if (profileError) throw profileError;

      // Mark wizard as completed
      const { error: roleError } = await supabase
        .from('user_roles')
        .update({ has_completed_wizard: true })
        .eq('user_id', user?.id);

      if (roleError) throw roleError;

      toast.success("Welcome to ProofLab! 🎓");
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
        <h2 className="text-2xl font-bold text-foreground mb-2">Basic Information</h2>
        <p className="text-muted-foreground">Tell us about your college and contact details</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="collegeName">College/University Name *</Label>
          <Input
            id="collegeName"
            value={formData.collegeName}
            onChange={(e) => setFormData(prev => ({ ...prev, collegeName: e.target.value }))}
            placeholder="Enter college name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location (City, State) *</Label>
          <Input
            id="location"
            value={formData.location}
            onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
            placeholder="Enter location"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactPerson">Contact Person Name (TPO/Faculty) *</Label>
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
        <h2 className="text-2xl font-bold text-foreground mb-2">Student Data</h2>
        <p className="text-muted-foreground">Add students after setup</p>
      </div>

      <div className="flex items-start space-x-3 p-4 border rounded-lg bg-muted">
        <Upload className="h-5 w-5 mt-0.5 text-muted-foreground" />
        <div>
          <div className="font-medium">CSV upload from your dashboard</div>
          <div className="text-sm text-muted-foreground">
            Once your dashboard is ready, upload a CSV of students (Email, Name,
            Roll Number, Department) from the overview page.
          </div>
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
        <h2 className="text-2xl font-bold text-foreground mb-2">Confirmation</h2>
        <p className="text-muted-foreground">Review your details before submitting</p>
      </div>

      <div className="bg-muted p-6 rounded-lg space-y-4">
        <div>
          <h3 className="font-semibold text-foreground">College Information</h3>
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            <p><span className="font-medium">Name:</span> {formData.collegeName}</p>
            <p><span className="font-medium">Location:</span> {formData.location}</p>
            <p><span className="font-medium">Contact Person:</span> {formData.contactPerson}</p>
            <p><span className="font-medium">Email:</span> {formData.email}</p>
            <p><span className="font-medium">Contact Number:</span> {formData.contactNumber}</p>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-foreground">Student Data</h3>
          <div className="mt-2 text-sm text-muted-foreground">
            <p>Students can be added from the dashboard after setup</p>
          </div>
        </div>
      </div>

      <div className="flex space-x-4">
        <Button variant="outline" onClick={handleBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button onClick={handleSubmit} disabled={loading} className="flex-1">
          {loading ? "Creating Dashboard..." : "Create College Dashboard"}
        </Button>
      </div>
    </div>
  );

  return (
    <BrandFrame className="max-w-2xl" logoHome={false}>
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
                      ? 'bg-verified text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {step}
                </div>
              ))}
            </div>
            <div className="text-sm text-muted-foreground">
              Step {currentStep} of 3
            </div>
          </div>
          <CardTitle className="text-center text-2xl font-bold">
            College Onboarding Wizard
          </CardTitle>
        </CardHeader>

        <CardContent>
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
        </CardContent>
      </Card>
    </BrandFrame>
  );
}
