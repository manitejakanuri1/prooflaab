import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Loader2, Clock, Play, Code2, CheckCircle2, XCircle, Sparkles, Dices } from "lucide-react";
import Editor from "@monaco-editor/react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const SECONDS_PER_QUESTION = 15;
const SECONDS_PER_CODING_PROBLEM = 300;

interface Question {
  id: string;
  type: "mcq" | "short_answer";
  prompt: string;
  options?: string[];
}

interface CodingQuestion {
  id: string;
  language: string;
  prompt: string;
  starter_code: string;
  sample_test: { stdin: string; expected_output: string } | null;
}

interface RunResult {
  stdin: string;
  expected: string;
  actual: string;
  stderr: string;
  passed: boolean;
}

type ConfidenceLevel = "high" | "medium" | "low";

export interface AnswerScore {
  question_id: string;
  correctness_score: number;
  explanation: string;
  final_score: number;
  question_prompt: string;
  question_type: "mcq" | "short_answer";
  student_answer: string;
  correct_answer?: string;
  confidence?: ConfidenceLevel;
  confidence_flag?: "lucky_guess" | "overconfident" | null;
}

export interface ResumeScoreResult {
  skill_proof_score: number;
  resume_quality_score: number | null;
  ats_match_score: number | null;
  roadmap: string;
  voice_authenticity_score?: number | null;
  voice_notes?: string | null;
  coding_score?: number | null;
  answer_scores?: AnswerScore[];
}

interface TimedResumeAssessmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  resumeClaimsId: string;
  questions: Question[];
  onGraded: (result: ResumeScoreResult) => void;
}

interface RecordedAnswer {
  question_id: string;
  answer_text: string;
  selected_index?: number;
  confidence?: ConfidenceLevel;
}

const CONFIDENCE_OPTIONS: { value: ConfidenceLevel; label: string; emoji: string }[] = [
  { value: "high", label: "Nailed it", emoji: "😎" },
  { value: "medium", label: "Pretty sure", emoji: "🤔" },
  { value: "low", label: "Total guess", emoji: "😬" },
];

type Phase = "quiz" | "coding-loading" | "coding" | "coding-analyzing" | "results";

const TimedResumeAssessment = ({ open, onOpenChange, assessmentId, resumeClaimsId, questions, onGraded }: TimedResumeAssessmentProps) => {
  const { toast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_QUESTION);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [confidence, setConfidence] = useState<ConfidenceLevel | null>(null);
  const [answers, setAnswers] = useState<RecordedAnswer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const advancingRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("quiz");
  const [pendingResult, setPendingResult] = useState<ResumeScoreResult | null>(null);
  const [codingGenError, setCodingGenError] = useState(false);

  const [codingQuestions, setCodingQuestions] = useState<CodingQuestion[]>([]);
  const [codingIndex, setCodingIndex] = useState(0);
  const [code, setCode] = useState("");
  const [codingTimeLeft, setCodingTimeLeft] = useState(SECONDS_PER_CODING_PROBLEM);
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState<RunResult[] | null>(null);
  const [submittingCode, setSubmittingCode] = useState(false);
  const codingAdvancingRef = useRef(false);

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;
  const currentCodingQuestion = codingQuestions[codingIndex];
  const isLastCodingQuestion = codingIndex === codingQuestions.length - 1;

  const startCodingRound = useCallback(async () => {
    setPhase("coding-loading");
    setCodingGenError(false);
    try {
      const { data, error } = await supabase.functions.invoke("resume-coding-generate", {
        body: { resume_claims_id: resumeClaimsId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const qs: CodingQuestion[] = data.questions || [];
      setCodingQuestions(qs);
      setCodingIndex(0);
      setCode(qs[0]?.starter_code || "");
      setCodingTimeLeft(SECONDS_PER_CODING_PROBLEM);
      setRunResults(null);
      setPhase("coding");
    } catch (err: any) {
      console.error("Coding round generation failed:", err);
      toast({ title: "Couldn't load coding problems", description: err.message || "Please try again.", variant: "destructive" });
      setCodingGenError(true);
    }
  }, [resumeClaimsId, toast]);

  const submitAssessment = useCallback(async (finalAnswers: RecordedAnswer[]) => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-assessment-submit", {
        body: { assessment_id: assessmentId, answers: finalAnswers },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setPendingResult({
        skill_proof_score: data.skill_proof_score,
        resume_quality_score: data.resume_quality_score,
        ats_match_score: data.ats_match_score,
        roadmap: data.roadmap,
        answer_scores: data.answer_scores,
      });
      startCodingRound();
    } catch (err: any) {
      console.error("Assessment submit failed:", err);
      toast({ title: "Couldn't submit", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [assessmentId, toast, startCodingRound]);

  const advance = useCallback(() => {
    if (advancingRef.current || !currentQuestion) return;
    advancingRef.current = true;

    const recorded: RecordedAnswer = {
      question_id: currentQuestion.id,
      answer_text: currentQuestion.type === "mcq"
        ? (selectedOption !== null ? currentQuestion.options?.[selectedOption] ?? "" : "")
        : textAnswer,
      ...(currentQuestion.type === "mcq" && selectedOption !== null ? { selected_index: selectedOption } : {}),
      ...(confidence ? { confidence } : {}),
    };
    const nextAnswers = [...answers, recorded];
    setAnswers(nextAnswers);

    if (isLastQuestion) {
      submitAssessment(nextAnswers);
      return;
    }

    setCurrentIndex((i) => i + 1);
    setSelectedOption(null);
    setTextAnswer("");
    setConfidence(null);
    setTimeLeft(SECONDS_PER_QUESTION);
    advancingRef.current = false;
  }, [answers, confidence, currentQuestion, isLastQuestion, selectedOption, textAnswer, submitAssessment]);

  useEffect(() => {
    if (!open || submitting || phase !== "quiz") return;
    if (timeLeft <= 0) {
      advance();
      return;
    }
    const timer = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, open, submitting, phase, advance]);

  const runSample = async () => {
    if (!currentCodingQuestion) return;
    setRunning(true);
    setRunResults(null);
    try {
      const { data, error } = await supabase.functions.invoke("resume-code-execute", {
        body: { assessment_id: assessmentId, question_id: currentCodingQuestion.id, code, mode: "run" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRunResults(data.results);
    } catch (err: any) {
      console.error("Code run failed:", err);
      toast({ title: "Couldn't run code", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const advanceCoding = useCallback(async () => {
    if (codingAdvancingRef.current || !currentCodingQuestion) return;
    codingAdvancingRef.current = true;
    setSubmittingCode(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-code-execute", {
        body: { assessment_id: assessmentId, question_id: currentCodingQuestion.id, code, mode: "submit" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (isLastCodingQuestion) {
        setPhase("coding-analyzing");
        const finalResult: ResumeScoreResult = {
          ...(pendingResult as ResumeScoreResult),
          coding_score: data.coding_score,
        };
        setPendingResult(finalResult);
        onGraded(finalResult);
        setPhase("results");
        return;
      }

      setCodingIndex((i) => i + 1);
      setCode(codingQuestions[codingIndex + 1]?.starter_code || "");
      setCodingTimeLeft(SECONDS_PER_CODING_PROBLEM);
      setRunResults(null);
    } catch (err: any) {
      console.error("Code submit failed:", err);
      toast({ title: "Couldn't submit code", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmittingCode(false);
      codingAdvancingRef.current = false;
    }
  }, [assessmentId, code, codingIndex, codingQuestions, currentCodingQuestion, isLastCodingQuestion, onGraded, onOpenChange, pendingResult]);

  useEffect(() => {
    if (!open || phase !== "coding" || submittingCode) return;
    if (codingTimeLeft <= 0) {
      advanceCoding();
      return;
    }
    const timer = setTimeout(() => setCodingTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [codingTimeLeft, open, phase, submittingCode, advanceCoding]);

  if (phase === "quiz" && !currentQuestion) return null;

  const isWide = phase === "coding";

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className={`${isWide ? "max-w-4xl" : "max-w-2xl"} [&>button]:hidden`}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {phase === "quiz" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>Prove your resume</span>
                <span className={`flex items-center gap-1 text-sm font-normal ${timeLeft <= 5 ? "text-destructive" : "text-muted-foreground"}`}>
                  <Clock className="h-4 w-4" /> {timeLeft}s
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-1 mb-2">
              <Progress value={(currentIndex / questions.length) * 100} />
              <p className="text-xs text-muted-foreground">Question {currentIndex + 1} of {questions.length}</p>
            </div>

            <div className="space-y-4" key={currentQuestion.id}>
              <p className="font-medium">{currentQuestion.prompt}</p>

              {currentQuestion.type === "mcq" ? (
                <RadioGroup
                  value={selectedOption !== null ? selectedOption.toString() : ""}
                  onValueChange={(v) => setSelectedOption(parseInt(v, 10))}
                >
                  {currentQuestion.options?.map((opt, idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <RadioGroupItem value={idx.toString()} id={`opt-${idx}`} />
                      <Label htmlFor={`opt-${idx}`} className="text-sm font-normal cursor-pointer">
                        {opt}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <Textarea
                  value={textAnswer}
                  onChange={(e) => setTextAnswer(e.target.value)}
                  placeholder="Explain in your own words..."
                  rows={4}
                  autoFocus
                />
              )}

              <div className="space-y-1.5 pt-1">
                <p className="text-xs text-muted-foreground">How sure are you, honestly?</p>
                <div className="flex gap-2">
                  {CONFIDENCE_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setConfidence(c.value)}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                        confidence === c.value
                          ? "border-primary bg-primary/10 font-medium"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <span className="mr-1">{c.emoji}</span>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Button onClick={advance} disabled={submitting} className="w-full mt-4">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Grading...
                </>
              ) : isLastQuestion ? (
                "Finish"
              ) : (
                "Next"
              )}
            </Button>
          </>
        )}

        {phase === "coding-loading" && (
          <div className="flex flex-col items-center gap-3 py-10">
            {codingGenError ? (
              <>
                <p className="text-sm text-muted-foreground">Couldn't load coding problems.</p>
                <Button onClick={startCodingRound}>Retry</Button>
              </>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm text-muted-foreground">Building your coding problems...</p>
              </>
            )}
          </div>
        )}

        {phase === "coding" && currentCodingQuestion && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Code2 className="h-5 w-5" /> Coding round
                </span>
                <span className={`flex items-center gap-1 text-sm font-normal ${codingTimeLeft <= 30 ? "text-destructive" : "text-muted-foreground"}`}>
                  <Clock className="h-4 w-4" /> {Math.floor(codingTimeLeft / 60)}:{(codingTimeLeft % 60).toString().padStart(2, "0")}
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-1 mb-2">
              <Progress value={(codingIndex / codingQuestions.length) * 100} />
              <p className="text-xs text-muted-foreground">Problem {codingIndex + 1} of {codingQuestions.length} — {currentCodingQuestion.language}</p>
            </div>

            <div className="space-y-3" key={currentCodingQuestion.id}>
              <p className="text-sm">{currentCodingQuestion.prompt}</p>
              {currentCodingQuestion.sample_test && (
                <div className="text-xs bg-muted rounded p-2 font-mono">
                  <div>sample input: {currentCodingQuestion.sample_test.stdin || "(none)"}</div>
                  <div>expected output: {currentCodingQuestion.sample_test.expected_output}</div>
                </div>
              )}

              <div className="border rounded-md overflow-hidden">
                <Editor
                  height="260px"
                  language={currentCodingQuestion.language}
                  value={code}
                  onChange={(v) => setCode(v || "")}
                  theme="vs-dark"
                  options={{ minimap: { enabled: false }, fontSize: 13 }}
                />
              </div>

              {runResults && (
                <div className="space-y-1">
                  {runResults.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {r.passed ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                      <div className="font-mono">
                        <div>expected: {r.expected}</div>
                        <div>got: {r.actual || "(empty)"}{r.stderr && ` — ${r.stderr}`}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={runSample} disabled={running || submittingCode} className="flex-1">
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Run sample
              </Button>
              <Button onClick={advanceCoding} disabled={submittingCode} className="flex-1">
                {submittingCode ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...
                  </>
                ) : isLastCodingQuestion ? (
                  "Finish"
                ) : (
                  "Submit & next"
                )}
              </Button>
            </div>
          </>
        )}

        {phase === "coding-analyzing" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm text-muted-foreground">Finishing up...</p>
          </div>
        )}

        {phase === "results" && pendingResult && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Assessment complete
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{pendingResult.resume_quality_score ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">Resume Quality</div>
                </div>
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{pendingResult.ats_match_score ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">ATS Match</div>
                </div>
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{pendingResult.skill_proof_score}</div>
                  <div className="text-xs text-muted-foreground mt-1">Skill Proof</div>
                </div>
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{pendingResult.coding_score ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">Coding</div>
                </div>
              </div>
              {pendingResult.answer_scores && pendingResult.answer_scores.length > 0 && (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  <p className="text-sm font-medium">Question review</p>
                  {pendingResult.answer_scores.map((s) => (
                    <div key={s.question_id} className="border rounded-lg p-3 text-sm space-y-1">
                      <div className="flex items-start gap-2">
                        {s.final_score >= 70 ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        )}
                        <p className="font-medium">{s.question_prompt}</p>
                      </div>
                      {s.confidence_flag === "lucky_guess" && (
                        <p className="flex items-center gap-1 text-xs text-amber-600">
                          <Dices className="h-3.5 w-3.5" /> Called it a guess... and nailed it. Lucky!
                        </p>
                      )}
                      {s.confidence_flag === "overconfident" && (
                        <p className="flex items-center gap-1 text-xs text-amber-600">
                          <Sparkles className="h-3.5 w-3.5" /> Felt confident, but this one wasn't it — worth a second look.
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">Your answer: {s.student_answer}</p>
                      {s.question_type === "mcq" && s.final_score < 70 && s.correct_answer && (
                        <p className="text-xs text-muted-foreground">Correct answer: {s.correct_answer}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{s.explanation}</p>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="text-sm font-medium mb-1">Your roadmap</p>
                <p className="text-sm text-muted-foreground whitespace-pre-line">{pendingResult.roadmap}</p>
              </div>
              <Button className="w-full" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TimedResumeAssessment;
