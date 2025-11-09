import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Settings, Shield, Brain, Github, TrendingUp } from "lucide-react";
import { useVerificationSettings } from "@/hooks/useVerificationSettings";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const VerificationSettingsPage = () => {
  const { user } = useAuth();
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const { settings, updateSettings } = useVerificationSettings(collegeId || undefined);
  
  const [minTrustScore, setMinTrustScore] = useState(10);
  const [minConceptualScore, setMinConceptualScore] = useState(30);
  const [minAiLikelihood, setMinAiLikelihood] = useState(50);
  const [minAuthenticityScore, setMinAuthenticityScore] = useState(40);
  const [autoApproveThreshold, setAutoApproveThreshold] = useState(70);

  useEffect(() => {
    const fetchCollegeId = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();
      
      if (data) setCollegeId(data.id);
    };
    fetchCollegeId();
  }, [user]);

  useEffect(() => {
    if (settings) {
      setMinTrustScore(settings.min_trust_score);
      setMinConceptualScore(settings.min_conceptual_score);
      setMinAiLikelihood(settings.min_ai_likelihood);
      setMinAuthenticityScore(settings.min_authenticity_score);
      setAutoApproveThreshold(settings.auto_approve_threshold);
    }
  }, [settings]);

  const handleSave = async () => {
    if (!collegeId) return;

    await updateSettings.mutateAsync({
      college_id: collegeId,
      min_trust_score: minTrustScore,
      min_conceptual_score: minConceptualScore,
      min_ai_likelihood: minAiLikelihood,
      min_authenticity_score: minAuthenticityScore,
      auto_approve_threshold: autoApproveThreshold,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Verification Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Verification Thresholds</CardTitle>
          <CardDescription>
            Customize the minimum scores required for automatic approval and manual review flags.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Trust Score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Minimum Trust Score
              </Label>
              <span className="text-sm font-bold">{minTrustScore}</span>
            </div>
            <Slider 
              value={[minTrustScore]} 
              onValueChange={([val]) => setMinTrustScore(val)}
              min={0}
              max={100}
              step={5}
            />
            <p className="text-xs text-muted-foreground">
              Submissions below this score will be flagged for manual review
            </p>
          </div>

          {/* Conceptual Score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-600" />
                Minimum Conceptual Score
              </Label>
              <span className="text-sm font-bold">{minConceptualScore}</span>
            </div>
            <Slider 
              value={[minConceptualScore]} 
              onValueChange={([val]) => setMinConceptualScore(val)}
              min={0}
              max={100}
              step={5}
            />
            <p className="text-xs text-muted-foreground">
              Students must score at least this on conceptual questions
            </p>
          </div>

          {/* AI Likelihood */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-blue-600" />
                Minimum Human Likelihood
              </Label>
              <span className="text-sm font-bold">{minAiLikelihood}%</span>
            </div>
            <Slider 
              value={[minAiLikelihood]} 
              onValueChange={([val]) => setMinAiLikelihood(val)}
              min={0}
              max={100}
              step={5}
            />
            <p className="text-xs text-muted-foreground">
              Code must appear at least this human-written
            </p>
          </div>

          {/* Authenticity Score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Github className="h-4 w-4 text-gray-600" />
                Minimum Commit Authenticity
              </Label>
              <span className="text-sm font-bold">{minAuthenticityScore}</span>
            </div>
            <Slider 
              value={[minAuthenticityScore]} 
              onValueChange={([val]) => setMinAuthenticityScore(val)}
              min={0}
              max={100}
              step={5}
            />
            <p className="text-xs text-muted-foreground">
              GitHub commit patterns must score at least this
            </p>
          </div>

          {/* Auto Approve Threshold */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
                Auto-Approve Threshold
              </Label>
              <span className="text-sm font-bold">{autoApproveThreshold}</span>
            </div>
            <Slider 
              value={[autoApproveThreshold]} 
              onValueChange={([val]) => setAutoApproveThreshold(val)}
              min={50}
              max={100}
              step={5}
            />
            <p className="text-xs text-muted-foreground">
              Submissions with trust scores above this will be auto-approved
            </p>
          </div>

          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default VerificationSettingsPage;
