import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Loader2, Clock, Play, Code2, CheckCircle2, XCircle, Sparkles, Dices, AlertTriangle } from "lucide-react";
import Editor from "@monaco-editor/react";
import { supabase } from "@/integrations/supabase/client";
import {
  formatArguments, formatReturn, functionSpecOf, hiddenSummaryText, isHiddenSummary, safeResultRows, signatureLine,
  type HiddenSummary,
} from "@/lib/functionSignature";
import { verdictLabel, type Verdict } from "@/lib/codingVerdicts";
import { useToast } from "@/hooks/use-toast";
import { RoadmapStages } from "./RoadmapStages";

// 15s for everything moved the screen on before a student could read the
// question, let alone type an answer. Must match resume-assessment-submit.
const secondsFor = (q?: { type?: string }) => (q?.type === "mcq" ? 30 : 90);
const SECONDS_PER_CODING_PROBLEM = 300;
/**
 * Time handed back when the executor is unreachable.
 *
 * An auto-submit fires at zero seconds. Without this the timer stays at zero,
 * the effect watching it calls straight back into a runner already known to be
 * down, and the student sits in a retry loop they cannot break.
 */
const RUNNER_RETRY_SECONDS = 90;

/**
 * Reads the JSON body of a failed edge function call.
 *
 * supabase-js reports a non-2xx as an error and leaves data null, so the
 * server's explanation is only reachable through the attached response.
 */
const readFunctionError = async (error: unknown): Promise<Record<string, unknown> | null> => {
  const context = (error as { context?: Response })?.context;
  if (!context || typeof context.json !== "function") return null;
  try {
    return await context.clone().json();
  } catch {
    return null;
  }
};

/**
 * Refuses copy, cut, paste and drop.
 *
 * A question that can be copied is a question that can be pasted into an AI,
 * and an answer box that accepts a paste accepts someone else's work. This does
 * not stop a determined person with a second phone — it stops the easy version,
 * which is most of it.
 */
const blockClipboard = (e: React.ClipboardEvent | React.DragEvent) => e.preventDefault();

interface Question {
  id: string;
  type: "mcq" | "short_answer";
  prompt: string;
  options?: string[];
  /** Subject heading shown above the question. Absent on older saved questions. */
  topic?: string;
}

interface CodingQuestion {
  id: string;
  language: string;
  prompt: string;
  starter_code: string;
  sample_test: { stdin: string; expected_output: string } | null;
  /** "function" for implement-a-function problems; absent on stdio (and older) rounds. */
  kind?: string;
  function_spec?: unknown;
}

interface RunResult {
  /** false only for a hidden test; such rows are collapsed into a count (safeResultRows). */
  visible?: boolean;
  stdin: string;
  expected: string;
  actual: string;
  stderr: string;
  passed: boolean;
  /** Absent on results graded before verdicts existed. */
  verdict?: Verdict;
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
  project_proof_score?: number | null;
  reasoning_score?: number | null;
  interview_readiness_score?: number | null;
  answer_scores?: AnswerScore[];
  skill_gap?: { verified: string[]; needs_improvement: string[]; missing: string[] } | null;
}

interface TimedResumeAssessmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  /**
   * Which side of the intake this test came from. Passed straight through as
   * the request body, so the edge functions receive exactly one of the two
   * source ids — the same rule the database enforces on the assessment row.
   */
  source: { resume_claims_id: string } | { student_interest_id: string };
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

const TimedResumeAssessment = ({ open, onOpenChange, assessmentId, source, questions, onGraded }: TimedResumeAssessmentProps) => {
  const { toast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(() => secondsFor(questions[0]));
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [confidence, setConfidence] = useState<ConfidenceLevel | null>(null);
  const [answers, setAnswers] = useState<RecordedAnswer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const advancingRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("quiz");
  const [pendingResult, setPendingResult] = useState<ResumeScoreResult | null>(null);

  const [codingQuestions, setCodingQuestions] = useState<CodingQuestion[]>([]);
  const [codingIndex, setCodingIndex] = useState(0);
  const [code, setCode] = useState("");
  const [codingTimeLeft, setCodingTimeLeft] = useState(SECONDS_PER_CODING_PROBLEM);
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState<(RunResult | HiddenSummary)[] | null>(null);
  const [submittingCode, setSubmittingCode] = useState(false);
  // Set when the executor itself is down, so the student is told it is not their
  // code rather than shown six silently failed test cases.
  const [runnerBusy, setRunnerBusy] = useState<string | null>(null);
  const codingAdvancingRef = useRef(false);

  const [codingGenError, setCodingGenError] = useState(false);

  const dialogContentRef = useRef<HTMLDivElement>(null);
  const skipNextScrollRef = useRef(false);

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;
  const currentCodingQuestion = codingQuestions[codingIndex];
  const codingSpec = currentCodingQuestion ? functionSpecOf(currentCodingQuestion) : null;
  const isLastCodingQuestion = codingIndex === codingQuestions.length - 1;

  const applyCodingQuestions = (qs: CodingQuestion[]) => {
    setCodingQuestions(qs);
    setCodingIndex(0);
    setCode(qs[0]?.starter_code || "");
    setCodingTimeLeft(SECONDS_PER_CODING_PROBLEM);
    setRunResults(null);
    setPhase("coding");
  };

  // Regenerates just the coding round. Used both as the initial fetch (fired
  // alongside grading in submitAssessment) and as the retry action if that
  // fetch fails — retrying never re-submits the already-graded quiz answers.
  const retryCodingGen = useCallback(async () => {
    setPhase("coding-loading");
    setCodingGenError(false);
    try {
      const { data, error } = await supabase.functions.invoke("resume-coding-generate", {
        body: source,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      applyCodingQuestions(data.questions || []);
    } catch (err: any) {
      console.error("Coding round generation failed:", err);
      toast({ title: "Couldn't load coding problems", description: err.message || "Please try again.", variant: "destructive" });
      setCodingGenError(true);
    }
  }, [source, toast]);

  // Grading and coding-problem generation don't depend on each other's output,
  // so they're fired together instead of back-to-back — halves the wait after
  // the last question instead of stacking two sequential LLM round trips.
  // They're tracked independently (allSettled, not all) so a coding-gen failure
  // never throws away a grading result that already succeeded.
  const submitAssessment = useCallback(async (finalAnswers: RecordedAnswer[]) => {
    setSubmitting(true);
    setPhase("coding-loading");
    setCodingGenError(false);

    const [submitOutcome, codingOutcome] = await Promise.allSettled([
      supabase.functions.invoke("resume-assessment-submit", {
        body: { assessment_id: assessmentId, answers: finalAnswers },
      }),
      supabase.functions.invoke("resume-coding-generate", {
        body: source,
      }),
    ]);

    const submitErr =
      submitOutcome.status === "rejected" ? submitOutcome.reason
      : submitOutcome.value.error ? submitOutcome.value.error
      : submitOutcome.value.data?.error ? new Error(submitOutcome.value.data.error)
      : null;

    if (submitErr) {
      // An attempt refused for running over time is not a failure to retry:
      // sending the same answers again will be refused again. Say so, and close
      // so the student starts a clean attempt rather than sitting on a dead one.
      const body = await readFunctionError(submitErr);
      if (body?.time_exceeded) {
        toast({
          title: "This attempt took too long",
          description: String(body.error ?? "Please start a fresh attempt."),
          variant: "destructive",
        });
        setSubmitting(false);
        advancingRef.current = false;
        onOpenChange(false);
        return;
      }

      console.error("Assessment submit failed:", submitErr);
      toast({ title: "Couldn't submit", description: submitErr.message || "Please try again.", variant: "destructive" });
      setPhase("quiz");
      advancingRef.current = false;
      setSubmitting(false);
      return;
    }

    const data = (submitOutcome as PromiseFulfilledResult<any>).value.data;
    setPendingResult({
      skill_proof_score: data.skill_proof_score,
      resume_quality_score: data.resume_quality_score,
      ats_match_score: data.ats_match_score,
      roadmap: data.roadmap,
      answer_scores: data.answer_scores,
      project_proof_score: data.project_proof_score,
      reasoning_score: data.reasoning_score,
      interview_readiness_score: data.interview_readiness_score,
      skill_gap: data.skill_gap,
    });
    setSubmitting(false);

    const codingErr =
      codingOutcome.status === "rejected" ? codingOutcome.reason
      : codingOutcome.value.error ? codingOutcome.value.error
      : codingOutcome.value.data?.error ? new Error(codingOutcome.value.data.error)
      : null;

    if (codingErr) {
      console.error("Coding round generation failed:", codingErr);
      toast({ title: "Couldn't load coding problems", description: codingErr.message || "Please try again.", variant: "destructive" });
      setCodingGenError(true);
      return;
    }

    applyCodingQuestions((codingOutcome as PromiseFulfilledResult<any>).value.data.questions || []);
  }, [assessmentId, source, toast, onOpenChange]);

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
    setTimeLeft(secondsFor(questions[currentIndex + 1]));
    advancingRef.current = false;
  }, [answers, confidence, currentIndex, currentQuestion, isLastQuestion, questions, selectedOption, textAnswer, submitAssessment]);

  // Reload-resume: this component fully remounts on a page reload, so progress
  // (question index, recorded answers, coding round state) is snapshotted to
  // localStorage and restored on mount, keyed per-assessment. Timers reset to
  // full rather than being restored, so a reload never silently burns time.
  const progressStorageKey = `resume-assessment-progress-${assessmentId}`;
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(progressStorageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.phase && saved.phase !== "results") {
          setAnswers(saved.answers || []);
          setPendingResult(saved.pendingResult ?? null);
          if (saved.phase === "coding" && saved.codingQuestions?.length) {
            skipNextScrollRef.current = true;
            setCodingQuestions(saved.codingQuestions);
            setCodingIndex(saved.codingIndex || 0);
            setCode(saved.code || "");
            setCodingTimeLeft(SECONDS_PER_CODING_PROBLEM);
            setPhase("coding");
          } else if (saved.phase === "coding-loading" && saved.pendingResult) {
            // Grading already succeeded before the reload — only the coding
            // round is missing, so fetch just that instead of redoing the quiz.
            retryCodingGen();
          } else {
            skipNextScrollRef.current = true;
            const resumeAt = Math.min(saved.currentIndex ?? 0, Math.max(questions.length - 1, 0));
            setCurrentIndex(resumeAt);
            setTimeLeft(secondsFor(questions[resumeAt]));
            setPhase("quiz");
          }
        }
      }
    } catch {
      // corrupt/old snapshot — ignore, start fresh
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated || phase === "results") return;
    const snapshot = { phase, currentIndex, answers, pendingResult, codingQuestions, codingIndex, code };
    try {
      localStorage.setItem(progressStorageKey, JSON.stringify(snapshot));
    } catch {
      // storage full/unavailable — progress just won't resume, not fatal
    }
  }, [hydrated, phase, currentIndex, answers, pendingResult, codingQuestions, codingIndex, code, progressStorageKey]);

  useEffect(() => {
    if (phase === "results") {
      try { localStorage.removeItem(progressStorageKey); } catch { /* ignore */ }
    }
  }, [phase, progressStorageKey]);

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
      setRunnerBusy(null);
      setRunResults(data.results);
    } catch (err: any) {
      const body = await readFunctionError(err);
      if (body?.runner_unavailable) {
        setRunnerBusy(String(body.error ?? "The code runner is busy."));
        return;
      }
      console.error("Code run failed:", err);
      toast({ title: "Couldn't run code", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const advanceCoding = useCallback(async (mode: "submit" | "skip" = "submit") => {
    if (codingAdvancingRef.current || !currentCodingQuestion) return;
    codingAdvancingRef.current = true;
    setSubmittingCode(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-code-execute", {
        body: { assessment_id: assessmentId, question_id: currentCodingQuestion.id, code, mode },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRunnerBusy(null);

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
      const body = await readFunctionError(err);
      if (body?.runner_unavailable) {
        // Nothing was recorded server-side, so the question is still open. Hand
        // back time so the auto-submit at zero does not fire straight back into
        // a runner that is already down.
        setRunnerBusy(String(body.error ?? "The code runner is busy."));
        setCodingTimeLeft((t) => Math.max(t, RUNNER_RETRY_SECONDS));
        return;
      }
      console.error("Code submit failed:", err);
      toast({ title: "Couldn't submit code", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmittingCode(false);
      codingAdvancingRef.current = false;
    }
  }, [assessmentId, code, codingIndex, codingQuestions, currentCodingQuestion, isLastCodingQuestion, onGraded, pendingResult, toast]);

  useEffect(() => {
    if (!open || phase !== "coding" || submittingCode) return;
    if (codingTimeLeft <= 0) {
      advanceCoding();
      return;
    }
    const timer = setTimeout(() => setCodingTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [codingTimeLeft, open, phase, submittingCode, advanceCoding]);

  // New question/coding-problem renders should always start at the top of the
  // dialog — otherwise leftover scroll position from a longer previous question
  // hides the new one below the fold. Skipped once right after a reload-restore,
  // since that jump is a resume, not a fresh question the student needs pointed out.
  useEffect(() => {
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false;
      return;
    }
    dialogContentRef.current?.scrollTo({ top: 0 });
  }, [currentIndex, codingIndex, phase]);

  if (phase === "quiz" && !currentQuestion) return null;

  const isWide = phase === "coding";

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        ref={dialogContentRef}
        className={`${isWide ? "max-w-4xl" : "max-w-2xl"} max-h-[85vh] overflow-y-auto [&>button]:hidden`}
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
              {/* Names the subject before the question, so a student can see
                  which area is being tested rather than guessing from wording. */}
              {currentQuestion.topic && (
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {currentQuestion.topic}
                </p>
              )}
              <p className="font-medium select-none" onCopy={blockClipboard} onCut={blockClipboard}>
                {currentQuestion.prompt}
              </p>

              {currentQuestion.type === "mcq" ? (
                <RadioGroup
                  value={selectedOption !== null ? selectedOption.toString() : ""}
                  onValueChange={(v) => setSelectedOption(parseInt(v, 10))}
                >
                  {currentQuestion.options?.map((opt, idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <RadioGroupItem value={idx.toString()} id={`opt-${idx}`} />
                      <Label
                        htmlFor={`opt-${idx}`}
                        className="text-sm font-normal cursor-pointer select-none"
                        onCopy={blockClipboard}
                        onCut={blockClipboard}
                      >
                        {opt}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <Textarea
                  value={textAnswer}
                  onChange={(e) => setTextAnswer(e.target.value)}
                  onPaste={blockClipboard}
                  onDrop={blockClipboard}
                  placeholder="Explain in your own words..."
                  rows={4}
                  autoFocus
                />
              )}

              <div className="space-y-1.5 pt-1">
                <p className="text-xs text-muted-foreground">
                  How sure are you, honestly?
                  {confidence && <span className="ml-1 text-primary">— saved ✓</span>}
                </p>
                <div className="flex gap-2">
                  {CONFIDENCE_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={confidence === c.value}
                      onClick={() => setConfidence(c.value)}
                      className={`flex-1 rounded-md border-2 px-2 py-1.5 text-xs transition-colors ${
                        confidence === c.value
                          ? "border-primary bg-primary text-primary-foreground font-semibold shadow-sm"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <span className="text-lg" title={c.label} aria-label={c.label}>
                        {c.emoji}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Pinned to the bottom of the dialog: with a long question, four
                options and the confidence row, the button used to sit below the
                fold and students did not know there was a Next at all. */}
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-4 border-t bg-background px-6 py-3">
            <Button onClick={advance} disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Grading...
                </>
              ) : isLastQuestion ? (
                "Submit & finish"
              ) : (
                "Next"
              )}
            </Button>
            </div>
          </>
        )}

        {phase === "coding-loading" && (
          <div className="flex flex-col items-center gap-3 py-10">
            {codingGenError ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Your score is saved — just couldn't load the coding problems.
                </p>
                <Button onClick={retryCodingGen}>Retry</Button>
              </>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm text-muted-foreground">
                  {pendingResult ? "Building your coding problems..." : "Grading your answers & building your coding problems..."}
                </p>
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
              {codingSpec && (
                <pre className="text-xs bg-muted rounded p-2 font-mono overflow-x-auto">
                  {signatureLine(currentCodingQuestion.language, codingSpec)}
                </pre>
              )}
              {currentCodingQuestion.sample_test && (codingSpec ? (
                <div className="text-xs bg-muted rounded p-2 font-mono">
                  <div>arguments: {formatArguments(currentCodingQuestion.sample_test.stdin, codingSpec)}</div>
                  <div>expected return: {formatReturn(currentCodingQuestion.sample_test.expected_output)}</div>
                </div>
              ) : (
                <div className="text-xs bg-muted rounded p-2 font-mono">
                  <div>sample input: {currentCodingQuestion.sample_test.stdin || "(none)"}</div>
                  <div>expected output: {currentCodingQuestion.sample_test.expected_output}</div>
                </div>
              ))}

              <div className="border rounded-md overflow-hidden">
                <Editor
                  height="260px"
                  language={currentCodingQuestion.language}
                  value={code}
                  onChange={(v) => setCode(v || "")}
                  theme="vs-dark"
                  options={{ minimap: { enabled: false }, fontSize: 13 }}
                  // Monaco owns its own DOM, so a React onPaste never fires.
                  // The paste has to be refused on the editor's own input area.
                  onMount={(editor) => {
                    const dom = editor.getDomNode();
                    dom?.addEventListener("paste", (e) => e.preventDefault(), true);
                    dom?.addEventListener("drop", (e) => e.preventDefault(), true);
                  }}
                />
              </div>

              {runnerBusy && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Your code did not run</p>
                    <p className="text-muted-foreground">{runnerBusy}</p>
                    <p className="text-muted-foreground mt-1">
                      Nothing has been marked wrong and this question is still open.
                    </p>
                  </div>
                </div>
              )}

              {runResults && (
                <div className="space-y-1">
                  {safeResultRows<RunResult>(runResults).map((r, i) => {
                    if (isHiddenSummary(r)) {
                      return (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          {r.passed
                            ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                            : <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                          <div className="font-medium">{hiddenSummaryText(r)}</div>
                        </div>
                      );
                    }
                    const verdict: Verdict = r.verdict ?? (r.passed ? "accepted" : "wrong_answer");
                    const label = verdictLabel(verdict);
                    // Only a wrong answer is about the output. A crash or a
                    // build failure makes "expected vs got" noise around the
                    // one line that actually explains it.
                    const compareOutput = verdict === "accepted" || verdict === "wrong_answer";
                    return (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        {r.passed
                          ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                          : <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                        <div className="space-y-0.5">
                          <div className="font-medium not-italic">
                            {label.title}
                            {label.hint && <span className="font-normal text-muted-foreground"> — {label.hint}</span>}
                          </div>
                          {compareOutput && (
                            codingSpec ? (
                              <div className="font-mono">
                                <div>arguments: {formatArguments(r.stdin, codingSpec)}</div>
                                <div>expected return: {formatReturn(r.expected)}</div>
                                <div>returned: {r.actual ? formatReturn(r.actual) : "(nothing)"}</div>
                              </div>
                            ) : (
                              <div className="font-mono">
                                <div>expected: {r.expected}</div>
                                <div>got: {r.actual || "(empty)"}</div>
                              </div>
                            )
                          )}
                          {r.stderr && (
                            <pre className="font-mono whitespace-pre-wrap text-destructive/90">{r.stderr}</pre>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={runSample} disabled={running || submittingCode} className="flex-1">
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Run sample
              </Button>
              {/* You cannot submit code you have never run. Submitting blind is
                  how a pasted answer gets through without the student ever
                  seeing whether it works. */}
              {/* Skip moves on at once and scores this question 0. Without it a
                  student who could not get code to run had to wait out the timer. */}
              <Button
                variant="ghost"
                onClick={() => {
                  if (window.confirm("Skip this question? It will score 0.")) void advanceCoding("skip");
                }}
                disabled={submittingCode}
              >
                Skip
              </Button>
              <Button
                onClick={() => void advanceCoding("submit")}
                disabled={submittingCode || runResults === null}
                title={runResults === null ? "Run your code first" : undefined}
                className="flex-1"
              >
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
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{pendingResult.project_proof_score ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">Project Proof</div>
                </div>
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{pendingResult.reasoning_score ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">Reasoning</div>
                </div>
                <div className="border rounded-lg p-3 text-center col-span-2 sm:col-span-2">
                  <div className="text-2xl font-bold">{pendingResult.interview_readiness_score ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">Interview Readiness</div>
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
                      {s.confidence && (
                        <p className="text-xs text-muted-foreground">
                          You said: {CONFIDENCE_OPTIONS.find((c) => c.value === s.confidence)?.emoji}{" "}
                          {CONFIDENCE_OPTIONS.find((c) => c.value === s.confidence)?.label}
                        </p>
                      )}
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
                      <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Why: </span>{s.explanation}</p>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="text-sm font-medium mb-1">Your roadmap</p>
                <RoadmapStages roadmap={pendingResult.roadmap} />
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
