import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Search, Plus } from "lucide-react";

interface StudentWizardProps {
  onComplete: () => void;
}

interface StudentWizardData {
  keyInterests: string[];
  preferredSkills: string[];
  careerGoals: string;
}

const INTERESTS = [
  "Web Development", "Mobile Development", "Data Science", "Machine Learning",
  "Cybersecurity", "Cloud Computing", "DevOps", "UI/UX Design", "Game Development",
  "Blockchain", "IoT", "Robotics",
  "Prompt Engineering",
  "Quantitative Aptitude", "Logical Reasoning", "Verbal Ability", "HR & Behavioral Prep"
];

const INTEREST_SKILLS: Record<string, string[]> = {
  "Web Development":    ["HTML/CSS", "JavaScript", "TypeScript", "React", "Tailwind", "Node.js", "Express", "SQL", "PostgreSQL", "MongoDB", "REST APIs", "JWT Auth", "Next.js", "Vercel", "Vue.js", "Angular"],
  "Cloud Computing":    ["AWS", "EC2", "S3", "IAM", "VPC", "Lambda", "Linux", "Networking", "Docker", "Terraform", "Python", "Bash", "Kubernetes", "Azure", "GCP"],
  "Data Science":       ["Python", "Pandas", "NumPy", "SQL", "Statistics", "Matplotlib", "Seaborn", "Excel", "Power BI", "Tableau", "Jupyter"],
  "Machine Learning":   ["Python", "Pandas", "NumPy", "SQL", "scikit-learn", "PyTorch", "Linear Algebra", "Probability", "Feature Engineering", "FastAPI", "Docker", "Transformers", "LLM APIs", "RAG", "TensorFlow"],
  "Mobile Development": ["Kotlin", "Jetpack Compose", "Swift", "SwiftUI", "Flutter", "Dart", "REST APIs", "JSON", "Room", "SQLite", "Firebase", "App Store Publishing", "Java", "React Native"],
  "Cybersecurity":      ["Linux", "Networking", "Windows", "Active Directory", "Splunk", "Wazuh", "Log Analysis", "Wireshark", "Nmap", "Burp Suite", "Python", "OWASP Top 10", "Security+"],
  "UI/UX Design":       ["Figma", "Auto Layout", "Design Systems", "Wireframing", "Prototyping", "User Research", "Usability Testing", "Accessibility (WCAG)", "HTML/CSS"],
  "DevOps":             ["Linux", "Bash", "Python", "Docker", "Kubernetes", "Git", "CI/CD", "GitHub Actions", "Terraform", "Prometheus", "Grafana", "AWS", "Jenkins"],
  "IoT":                ["C", "C++", "ESP32", "STM32", "I2C/SPI/UART", "FreeRTOS", "MQTT", "Sensors", "Circuits/PCB", "Python"],
  "Game Development":   ["Unity", "C#", "Unreal", "C++", "3D Maths", "Physics", "Blender"],
  "Blockchain":         ["Solidity", "Foundry", "Hardhat", "ethers.js", "viem", "EVM Internals", "Smart Contract Security", "React", "JavaScript"],
  "Robotics":           ["Python", "C++", "ROS 2", "Control Systems", "OpenCV", "Embedded Systems", "Gazebo", "Linear Algebra"],
  "Prompt Engineering":       ["Prompt Basics", "Few-Shot Prompting", "Chain-of-Thought Prompting", "System Prompts", "Structured Output", "RAG Basics", "Agentic Loops", "Evaluating Prompts"],
  "Quantitative Aptitude":    ["Percentages", "Ratios & Proportions", "Time, Speed & Distance", "Profit & Loss", "Probability", "Permutations & Combinations"],
  "Logical Reasoning":        ["Syllogisms", "Blood Relations", "Seating Arrangement", "Coding-Decoding", "Series Completion"],
  "Verbal Ability":           ["Reading Comprehension", "Sentence Correction", "Vocabulary in Context", "Para Jumbles"],
  "HR & Behavioral Prep":     ["STAR Response Basics", "Common HR Questions", "Strengths & Weaknesses Framing", "Salary Negotiation Basics"],
};

// Expected on every track, so they are always offered.
const ALL_SKILLS_UNSORTED = Object.values(INTEREST_SKILLS).flat();
const CORE_SKILLS = ["Git & GitHub", "DSA", "Linux Basics"];

export default function StudentWizard({ onComplete }: StudentWizardProps) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<StudentWizardData>({
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

  // Only show skills that belong to the interests they picked - a flat list
  // made most interests impossible to cover.
  const visibleSkills = [...new Set([
    ...formData.keyInterests.flatMap(i => INTEREST_SKILLS[i] ?? []),
    ...CORE_SKILLS,
  ])];

  const [showOther, setShowOther] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");

  // Everything in the system, so a student who genuinely knows something outside
  // their chosen tracks can still claim it rather than being unable to say so.
  const allSkills = [...new Set([...ALL_SKILLS_UNSORTED, ...CORE_SKILLS])].sort();
  const otherMatches = skillQuery.trim()
    ? allSkills
        .filter((s) => !visibleSkills.includes(s))
        .filter((s) => s.toLowerCase().includes(skillQuery.trim().toLowerCase()))
        .slice(0, 12)
    : [];

  const handleSkillToggle = (skill: string) => {
    setFormData(prev => ({
      ...prev,
      preferredSkills: prev.preferredSkills.includes(skill)
        ? prev.preferredSkills.filter(s => s !== skill)
        : [...prev.preferredSkills, skill]
    }));
  };

  const handleNext = () => {
    if (currentStep === 1 && formData.keyInterests.length === 0) {
      toast.error("Please select at least one interest");
      return;
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
      // update, not upsert: StudentStart already created the row, and an upsert
      // would have to send full_name (NOT NULL) — which this form no longer
      // collects, so it would blank the name taken from the sign-up.
      const { error: profileError } = await supabase
        .from('student_profiles')
        .update({
          key_interests: formData.keyInterests,
          preferred_skills: formData.preferredSkills,
          career_goals: formData.careerGoals,
          profile_completed: true
        })
        .eq('user_id', user?.id);

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
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
                  {visibleSkills.map(skill => (
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

              <div>
                {!showOther ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowOther(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Other skills
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        autoFocus
                        value={skillQuery}
                        onChange={(e) => setSkillQuery(e.target.value)}
                        placeholder="Search any skill, e.g. Python, Figma, Solidity"
                        className="pl-9"
                      />
                    </div>
                    {skillQuery.trim() && otherMatches.length === 0 && (
                      <p className="text-sm text-muted-foreground">No skill matches that.</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {otherMatches.map((skill) => (
                        <Button
                          key={skill}
                          type="button"
                          size="sm"
                          variant={formData.preferredSkills.includes(skill) ? "default" : "outline"}
                          onClick={() => handleSkillToggle(skill)}
                        >
                          {skill}
                        </Button>
                      ))}
                    </div>
                    {formData.preferredSkills.filter((s) => !visibleSkills.includes(s)).length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Also selected: {formData.preferredSkills.filter((s) => !visibleSkills.includes(s)).join(", ")}
                      </p>
                    )}
                  </div>
                )}
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