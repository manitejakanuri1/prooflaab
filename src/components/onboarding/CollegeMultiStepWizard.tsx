import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
// Lucide React icons for College Multi-Step Wizard
import { ArrowLeft, ArrowRight, Upload, SkipForward } from "lucide-react";

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
  // Step 2
  uploadOption: 'upload' | 'skip';
  csvFile: File | null;
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
    contactNumber: "",
    uploadOption: 'skip',
    csvFile: null
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setFormData(prev => ({ ...prev, csvFile: file }));
    } else {
      toast.error("Please upload a valid CSV file");
    }
  };

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

      // TODO: Handle CSV upload if selected
      if (formData.uploadOption === 'upload' && formData.csvFile) {
        // This would require a file upload mechanism and processing
        console.log('CSV file to process:', formData.csvFile);
      }

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

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Basic Information</h2>
        <p className="text-gray-600">Tell us about your college and contact details</p>
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
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Student Upload Option</h2>
        <p className="text-gray-600">Upload student data or skip for now</p>
      </div>

      <RadioGroup
        value={formData.uploadOption}
        onValueChange={(value: 'upload' | 'skip') => setFormData(prev => ({ ...prev, uploadOption: value }))}
        className="space-y-4"
      >
        <div className="flex items-center space-x-2 p-4 border rounded-lg">
          <RadioGroupItem value="upload" id="upload" />
          <Label htmlFor="upload" className="flex-1">
            <div className="flex items-center space-x-2">
              <Upload className="h-5 w-5" />
              <div>
                <div className="font-medium">Upload CSV</div>
                <div className="text-sm text-gray-500">Upload student data (Emails, Names, Roll numbers, Dept, etc.)</div>
              </div>
            </div>
          </Label>
        </div>

        <div className="flex items-center space-x-2 p-4 border rounded-lg">
          <RadioGroupItem value="skip" id="skip" />
          <Label htmlFor="skip" className="flex-1">
            <div className="flex items-center space-x-2">
              <SkipForward className="h-5 w-5" />
              <div>
                <div className="font-medium">Skip for now</div>
                <div className="text-sm text-gray-500">Continue to dashboard, can upload later</div>
              </div>
            </div>
          </Label>
        </div>
      </RadioGroup>

      {formData.uploadOption === 'upload' && (
        <div className="space-y-2">
          <Label htmlFor="csvFile">Upload CSV File</Label>
          <Input
            id="csvFile"
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="cursor-pointer"
          />
          <p className="text-sm text-gray-500">
            CSV should contain columns: Email, Name, Roll Number, Department
          </p>
        </div>
      )}

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
          <h3 className="font-semibold text-gray-900">College Information</h3>
          <div className="mt-2 space-y-1 text-sm text-gray-600">
            <p><span className="font-medium">Name:</span> {formData.collegeName}</p>
            <p><span className="font-medium">Location:</span> {formData.location}</p>
            <p><span className="font-medium">Contact Person:</span> {formData.contactPerson}</p>
            <p><span className="font-medium">Email:</span> {formData.email}</p>
            <p><span className="font-medium">Contact Number:</span> {formData.contactNumber}</p>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-gray-900">Student Data</h3>
          <div className="mt-2 text-sm text-gray-600">
            {formData.uploadOption === 'upload' ? (
              <p>CSV file will be processed: {formData.csvFile?.name || 'No file selected'}</p>
            ) : (
              <p>Student data upload skipped - can be added later from dashboard</p>
            )}
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
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
            College Onboarding Wizard
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