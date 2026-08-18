import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TimedResumeAssessment, { ResumeScoreResult } from "@/components/dashboard/student/TimedResumeAssessment";
import { RoadmapStages } from "@/components/dashboard/student/RoadmapStages";
import { SkillGap } from "@/components/dashboard/student/SkillGap";
import { Loader2, Sparkles, ArrowRight, ClipboardList } from "lucide-react";

interface AssessmentQuestion {
  id: string;
  type: "mcq" | "short_answer";
  prompt: string;
  options?: string[];
  topic?: string;
}

/**
 * The Skip half of intake: the same test and the same scorecard the resume path
 * produces, built from the interests the student picked instead of from a file.
 *
 * There is no upload, no extraction and no claim-confirmation step here because
 * there is nothing to extract — the student typed their interests in directly,
 * so they are already confirmed. Everything from the quiz onwards is the
 * identical code path, including the timed assessment component.
 */
const StudentInterestOnboarding = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, loading: profileLoading } = useStudentProfile();

  const [checking, setChecking] = useState(true);
  const [interestId, setInterestId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<ResumeScoreResult | null>(null);

  // A student who has already been through this is sent on rather than made to
  // sit the same test twice — the same guard the resume path uses.
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;

    (async () => {
      const { data: existingScore } = await supabase
        .from("resume_scorecards")
        .select("id")
        .eq("student_id", profile.id)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (existingScore) {
        navigate("/student/dashboard", { replace: true });
        return;
      }

      // The wizard has already written the picks onto the profile, so this row
      // is built from there rather than asking for the same answers again.
      // Newest first: a student is allowed more than one interests row, the
      // same way the resume path allows more than one upload. Taking the
      // newest means changing your mind actually takes effect.
      const { data: existing } = await supabase
        .from("student_interests")
        .select("id")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (existing) {
        setInterestId(existing.id);
      } else {
        const { data: created, error } = await supabase
          .from("student_interests")
          .insert({
            student_id: profile.id,
            branch: profile.branch ?? null,
            year_of_study: profile.year_of_study ?? null,
            interests: profile.key_interests ?? [],
            skills: profile.preferred_skills ?? [],
            target_role: profile.career_goals ?? null,
            confirmed_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (cancelled) return;
        if (error) {
          toast({
            title: "Couldn't save your interests",
            description: error.message,
            variant: "destructive",
          });
        } else {
          setInterestId(created.id);
        }
      }
      setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.id, profile?.branch, profile?.year_of_study, profile?.key_interests, profile?.preferred_skills, profile?.career_goals, navigate, toast]);

  const handleStart = async () => {
    if (!interestId) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-question-generator", {
        body: { student_interest_id: interestId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setAssessmentId(data.assessment_id);
      setQuestions(data.questions || []);
      setModalOpen(true);
    } catch (err) {
      toast({
        title: "Couldn't build your questions",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  if (profileLoading || checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-background dark:from-orange-950/20 dark:to-background">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-orange-600 dark:text-orange-400 font-semibold text-sm mb-2">
            <Sparkles className="h-4 w-4" /> Let's build your proof
          </div>
          <h1 className="text-2xl font-bold">Let's see what you already know</h1>
          <p className="text-muted-foreground text-sm mt-1">
            A short set of questions built from the areas you picked, then a quick coding round.
          </p>
        </div>

        {!result && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your assessment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(profile?.key_interests ?? []).map((interest) => (
                  <span key={interest} className="text-xs border rounded-full px-3 py-1">
                    {interest}
                  </span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                Each question is shown one at a time with a short timer, so answer with what you
                actually know rather than looking anything up.
              </p>
              <Button onClick={handleStart} disabled={generating || !interestId}>
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building your questions...
                  </>
                ) : (
                  "Start assessment"
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ClipboardList className="h-5 w-5" /> Your results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{result.skill_proof_score}</div>
                  <div className="text-xs text-muted-foreground mt-1">Skill Proof</div>
                </div>
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{result.reasoning_score ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">Reasoning</div>
                </div>
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{result.coding_score ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">Coding</div>
                </div>
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{result.interview_readiness_score ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">Interview Readiness</div>
                </div>
              </div>

              {result.skill_gap && (
                <div className="border rounded-lg p-3">
                  <p className="text-sm font-medium mb-2">Skill gap</p>
                  <SkillGap skillGap={result.skill_gap} />
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-1">Your roadmap</p>
                <RoadmapStages roadmap={result.roadmap} />
              </div>
            </CardContent>
          </Card>
        )}

        {result && (
          <div className="mt-8 flex justify-center">
            <Button
              size="lg"
              className="min-w-56 text-base"
              onClick={() => navigate("/student/dashboard", { replace: true })}
            >
              Continue to dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {assessmentId && interestId && (
          <TimedResumeAssessment
            open={modalOpen}
            onOpenChange={setModalOpen}
            assessmentId={assessmentId}
            source={{ student_interest_id: interestId }}
            questions={questions}
            onGraded={setResult}
          />
        )}
      </div>
    </div>
  );
};

export default StudentInterestOnboarding;
