import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import TimedResumeAssessment, { type ResumeScoreResult } from "@/components/dashboard/student/TimedResumeAssessment";

interface Analysis {
  resume_claim_id: string;
  match: boolean;
  target_role: string;
  matched_skills: string[];
  missing_skills: string[];
  explanation: string;
}

interface InterestReviewProps {
  /** Called once the student has finished the assessment (or opted out of it). */
  onDone: () => void;
}

/**
 * Sits between the interest/skill pickers and the assessment.
 *
 * Asks the model whether the chosen skills actually support the chosen
 * interests, shows the student that judgement, then runs the SAME quiz +
 * coding assessment the resume path uses — the claims row written by
 * interests-analyze is what makes that reuse possible.
 */
const InterestReview = ({ onDone }: InterestReviewProps) => {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  // Their own choices, echoed back so the judgement is readable against them.
  const [picked, setPicked] = useState<{ interests: string[]; skills: string[] }>({ interests: [], skills: [] });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<unknown[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const run = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Read back what the wizard saved rather than passing it down, so the
      // analysis always reflects what is actually stored on the profile.
      const { data: profile } = await supabase
        .from("student_profiles")
        .select("key_interests, preferred_skills, career_goals")
        .eq("user_id", user.id)
        .maybeSingle();

      setPicked({
        interests: profile?.key_interests ?? [],
        skills: profile?.preferred_skills ?? [],
      });

      const { data, error: fnError } = await supabase.functions.invoke("interests-analyze", {
        body: {
          interests: profile?.key_interests ?? [],
          skills: profile?.preferred_skills ?? [],
          career_goals: profile?.career_goals ?? "",
        },
      });

      if (fnError || data?.error) {
        setError(data?.error ?? "Could not analyse your choices.");
        return;
      }
      setAnalysis(data as Analysis);
    };
    run().catch((e) => setError(e instanceof Error ? e.message : "Something went wrong"));
  }, []);

  const startAssessment = async () => {
    if (!analysis) return;
    setStarting(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("resume-question-generator", {
        body: { resume_claims_id: analysis.resume_claim_id },
      });
      if (fnError || data?.error) throw new Error(data?.error ?? "Could not build your questions.");

      setAssessmentId(data.assessment_id);
      setQuestions(data.questions ?? []);
      setModalOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the test.");
    } finally {
      setStarting(false);
    }
  };

  const handleGraded = (_result: ResumeScoreResult) => {
    setModalOpen(false);
    onDone();
  };

  if (error) {
    return (
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-lg">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={onDone}>Continue to dashboard</Button>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) {
    return (
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Looking at what you picked…</p>
      </div>
    );
  }

  return (
    <>
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            {analysis.match ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            )}
            <CardTitle className="text-xl">
              {analysis.match ? "That adds up." : "There's a gap here."}
            </CardTitle>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-3 pb-4 border-b">
            <div>
              <p className="text-sm text-muted-foreground mb-2">You picked</p>
              <div className="flex flex-wrap gap-2">
                {picked.interests.map((s, i) => (
                  <Badge key={`int-${s}-${i}`}>{s}</Badge>
                ))}
                {picked.interests.length === 0 && (
                  <span className="text-sm text-muted-foreground">nothing selected</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">You said you can already do</p>
              <div className="flex flex-wrap gap-2">
                {picked.skills.map((s, i) => (
                  <Badge key={`skl-${s}-${i}`} variant="secondary">{s}</Badge>
                ))}
                {picked.skills.length === 0 && (
                  <span className="text-sm text-muted-foreground">nothing selected</span>
                )}
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-1">Closest role</p>
            <p className="font-medium">{analysis.target_role}</p>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">What this means</p>
            <p className="text-sm leading-relaxed">{analysis.explanation}</p>
          </div>

          {analysis.matched_skills.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Skills that back this up</p>
              <div className="flex flex-wrap gap-2">
                {analysis.matched_skills.map((s, i) => (
                  <Badge key={`${s}-${i}`} variant="secondary">{s}</Badge>
                ))}
              </div>
            </div>
          )}

          {analysis.missing_skills.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">
                {analysis.match ? "Worth adding next" : "What this actually needs"}
              </p>
              <div className="flex flex-wrap gap-2">
                {analysis.missing_skills.map((s, i) => (
                  <Badge key={`${s}-${i}`} variant="outline">{s}</Badge>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t space-y-3">
            <p className="text-sm text-muted-foreground">
              Next: a short quiz and a coding round on what you picked, then your score
              and a roadmap.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={startAssessment} disabled={starting}>
                {starting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Building your questions…
                  </>
                ) : (
                  analysis.match ? "Start the test" : "Start anyway"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {assessmentId && (
        <TimedResumeAssessment
          open={modalOpen}
          onOpenChange={setModalOpen}
          assessmentId={assessmentId}
          resumeClaimsId={analysis.resume_claim_id}
          questions={questions as never}
          onGraded={handleGraded}
        />
      )}
    </>
  );
};

export default InterestReview;
