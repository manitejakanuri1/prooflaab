import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { readFunctionError } from "@/lib/functionError";
import CodeSandboxEmbed from "./CodeSandboxEmbed";
import {
  ArrowRight,
  Check,
  Hammer,
  Loader2,
  PartyPopper,
  RotateCcw,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";

interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
}

interface SandboxSpec {
  template: "html" | "javascript";
  files: Record<string, string>;
}

interface LevelPayload {
  level: {
    id: string;
    track_slug: string;
    level_number: number;
    sub_level: number;
    kind: "explanation" | "checkpoint";
    skill: string;
    title: string;
  };
  step_index: number | null;
  total_steps: number;
  explanation: string;
  sandbox: SandboxSpec | null;
  quiz: QuizQuestion[];
  proof: { title: string; brief: string } | null;
  status: string;
  /** On a placed level: the line from their resume that earned the tick. */
  evidence: string | null;
  best_score: number;
  attempts: number;
}

interface QuizResult {
  question_id: string;
  prompt: string;
  selected_index: number | null;
  correct_index: number;
  correct: boolean;
  explanation: string;
}

interface SubmitPayload {
  passed: boolean;
  score: number;
  out_of: number;
  results: QuizResult[];
  proof: { title: string; brief: string } | null;
  xp_awarded: number;
  next_level: { level_number: number; sub_level: number; skill: string; title: string } | null;
  track_complete: boolean;
  task_id: string | null;
}

interface LevelDetailProps {
  trackSlug: string;
  levelNumber: number | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a pass, so the map can redraw with the new unlock. */
  onCleared: () => void;
  /** Jump straight into the next topic instead of closing back to the map. */
  onContinue: (levelNumber: number) => void;
}

type Phase = "loading" | "read" | "quiz" | "result" | "error";

const LevelDetail = ({ trackSlug, levelNumber, onOpenChange, onCleared, onContinue }: LevelDetailProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorText, setErrorText] = useState("");
  const [data, setData] = useState<LevelPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [result, setResult] = useState<SubmitPayload | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const open = levelNumber !== null;

  const fetchStep = async (advanceStep: boolean, skipToCheckpoint = false) => {
    const { data: payload, error } = await supabase.functions.invoke("level-open", {
      body: {
        track_slug: trackSlug,
        level_number: levelNumber,
        advance_step: advanceStep,
        skip_to_checkpoint: skipToCheckpoint,
      },
    });
    if (error) {
      const body = await readFunctionError(error);
      setErrorText(String(body?.error ?? "Could not open this topic. Please try again in a moment."));
      setPhase("error");
      return;
    }
    setData(payload as LevelPayload);
    setPhase("read");
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setPhase("loading");
      setData(null);
      setResult(null);
      setAnswers({});
      if (!cancelled) await fetchStep(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trackSlug, levelNumber]);

  // Each phase starts a new screen's worth of content; keeping the old scroll
  // position leaves people halfway down a page they have not read yet.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [phase, data?.level.id]);

  const handleNextStep = async () => {
    setAdvancing(true);
    await fetchStep(true);
    setAdvancing(false);
  };

  const handleSkipToCheckpoint = async () => {
    setSkipping(true);
    await fetchStep(false, true);
    setSkipping(false);
  };

  const handleSubmit = async () => {
    if (!data) return;
    setSubmitting(true);

    const { data: payload, error } = await supabase.functions.invoke("level-quiz-submit", {
      body: {
        level_id: data.level.id,
        answers: data.quiz.map((q) => ({
          question_id: q.id,
          selected_index: answers[q.id] ?? -1,
        })),
      },
    });

    setSubmitting(false);

    if (error) {
      const body = await readFunctionError(error);
      toast({
        title: "Couldn't check your answers",
        description: String(body?.error ?? "Please try again."),
        variant: "destructive",
      });
      return;
    }

    const submitted = payload as SubmitPayload;
    setResult(submitted);
    setPhase("result");
    if (submitted.passed) onCleared();
  };

  const allAnswered = data ? data.quiz.every((q) => answers[q.id] !== undefined) : false;
  const isCheckpoint = data?.level.kind === "checkpoint";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="font-mono">
              Topic {levelNumber}
            </Badge>
            {data && <Badge variant="outline">{data.level.skill}</Badge>}
            {data && !isCheckpoint && data.step_index && (
              <Badge variant="outline">
                Step {data.step_index} of {data.total_steps}
              </Badge>
            )}
            {data && isCheckpoint && <Badge variant="outline">Check yourself</Badge>}
          </div>
          <DialogTitle className="text-xl mt-2 text-left">
            {data?.level.title ?? "Loading…"}
          </DialogTitle>
        </DialogHeader>

        <div ref={scrollRef} className="overflow-y-auto px-6 py-5 flex-1">
          {phase === "loading" && (
            <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">Writing this topic…</p>
            </div>
          )}

          {phase === "error" && (
            <div className="py-12 text-center space-y-4">
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">{errorText}</p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Back to the map
              </Button>
            </div>
          )}

          {phase === "read" && data && (
            <div className="space-y-5 animate-level-in">
              {/* Placement ticked this off from their resume without ever asking a
                  question about it. Saying so out loud is the difference between
                  a map they trust and one that quietly claims things for them. */}
              {data.status === "placed" && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
                  <p className="text-sm">
                    <span className="font-semibold">We ticked this off for you.</span>{" "}
                    {data.evidence ?? `Your resume says you know ${data.level.skill}.`}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    That is a claim, not a test — nobody asked you a question about it. Finish the
                    check at the end and the tick becomes a real one.
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {data.explanation.split(/\n{2,}/).map((para, i) => (
                  <p key={i} className="text-[15px] leading-relaxed">
                    {para.trim()}
                  </p>
                ))}
              </div>

              {data.sandbox && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Try it yourself</p>
                  <CodeSandboxEmbed template={data.sandbox.template} files={data.sandbox.files} />
                </div>
              )}

              {isCheckpoint && data.proof && (
                <div className="rounded-lg border bg-muted/40 p-4">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Hammer className="h-4 w-4 text-primary" />
                    Then you'll build: {data.proof.title}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">{data.proof.brief}</p>
                </div>
              )}

              {isCheckpoint && data.attempts > 0 && (
                <p className="text-xs text-muted-foreground">
                  You've tried this check {data.attempts} {data.attempts === 1 ? "time" : "times"} —
                  best {data.best_score} of {data.quiz.length || "—"}.
                </p>
              )}
            </div>
          )}

          {phase === "quiz" && data && (
            <div className="space-y-6 animate-level-in">
              <p className="text-sm text-muted-foreground">
                {data.quiz.length} questions on everything above. Pass and the next topic opens.
              </p>
              {data.quiz.map((q, qi) => (
                <div key={q.id} className="space-y-2">
                  <p className="text-sm font-medium leading-snug">
                    {qi + 1}. {q.prompt}
                  </p>
                  <div className="space-y-1.5">
                    {q.options.map((option, oi) => {
                      const selected = answers[q.id] === oi;
                      return (
                        <button
                          key={oi}
                          type="button"
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                          className={`w-full text-left text-sm rounded-md border px-3 py-2 transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 font-medium"
                              : "hover:bg-muted/60"
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {phase === "result" && result && data && (
            <div className="space-y-5">
              <div
                className={`rounded-lg border p-4 animate-pop-in ${
                  result.passed
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-amber-500/40 bg-amber-500/10"
                }`}
              >
                <p className="font-semibold flex items-center gap-2">
                  {result.passed ? (
                    <PartyPopper className="h-5 w-5 text-emerald-600 animate-cheer" />
                  ) : (
                    <RotateCcw className="h-5 w-5 text-amber-600" />
                  )}
                  {result.score} out of {result.out_of}
                  {result.passed ? " — topic cleared" : " — not quite yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {result.passed
                    ? result.track_complete
                      ? "That was the last topic on this path. Genuinely well done."
                      : `Next up: ${result.next_level?.skill}.`
                    : "Read the explanations below, then have another go. Nothing is lost."}
                </p>
                {result.xp_awarded > 0 && (
                  <Badge variant="secondary" className="mt-2 gap-1">
                    <Sparkles className="h-3 w-3" />+{result.xp_awarded} XP
                  </Badge>
                )}
              </div>

              {/* The answers come back only now. This is where the actual
                  teaching happens — worth reading whether they passed or not. */}
              <div className="space-y-3">
                {result.results.map((r, i) => (
                  <div key={r.question_id} className="rounded-md border p-3">
                    <p className="text-sm font-medium flex items-start gap-2">
                      {r.correct ? (
                        <Check className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                      ) : (
                        <X className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                      )}
                      <span>
                        {i + 1}. {r.prompt}
                      </span>
                    </p>
                    {!r.correct && (
                      <p className="text-sm mt-2 pl-6">
                        <span className="text-muted-foreground">Right answer: </span>
                        {data.quiz.find((q) => q.id === r.question_id)?.options[r.correct_index]}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-1 pl-6">{r.explanation}</p>
                  </div>
                ))}
              </div>

              {result.passed && result.proof && (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    Your proof task: {result.proof.title}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">{result.proof.brief}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Finishing it earns this topic its star — knowing it is good, proving it is
                    the point.
                  </p>
                  {result.task_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 gap-1.5"
                      onClick={() => {
                        onOpenChange(false);
                        navigate('/student/tasks/assigned');
                      }}
                    >
                      Go to this task
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {(phase === "read" || phase === "quiz" || phase === "result") && (
          <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3">
            {phase === "quiz" && data ? (
              <Progress
                value={(Object.keys(answers).length / data.quiz.length) * 100}
                className="h-1.5 flex-1"
              />
            ) : (
              <span className="flex-1" />
            )}

            {phase === "read" && !isCheckpoint && (
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSkipToCheckpoint}
                    disabled={skipping || advancing}
                    className="gap-1.5 text-muted-foreground"
                  >
                    {skipping && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Skip to check
                  </Button>
                  <Button onClick={handleNextStep} disabled={advancing || skipping} className="gap-2">
                    {advancing && <Loader2 className="h-4 w-4 animate-spin" />}
                    Got it — next
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
                {/* Legally not legal advice, just a nudge: skipping is one click, so
                    make the click cost something — a joke they'll half-remember
                    the next time they're stuck and wish they hadn't skipped. */}
                <p className="text-[11px] text-muted-foreground/70 italic max-w-xs text-right">
                  ⚠️ Skipping voids the "I definitely learned this" warranty. Side
                  effects may include blank stares in interviews. Reading it once
                  now is cheaper than re-learning it live, in front of someone
                  judging you.
                </p>
              </div>
            )}

            {phase === "read" && isCheckpoint && (
              <Button onClick={() => setPhase("quiz")} className="gap-2">
                Got it — quiz me
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}

            {phase === "quiz" && (
              <Button onClick={handleSubmit} disabled={!allAnswered || submitting} className="gap-2">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {allAnswered ? "Check my answers" : `Answer all ${data?.quiz.length ?? ""}`}
              </Button>
            )}

            {phase === "result" && result && (
              <div className="flex gap-2">
                {!result.passed && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAnswers({});
                      setPhase("read");
                    }}
                    className="gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Read it again
                  </Button>
                )}
                {result.passed && result.next_level && (
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Back to the map
                  </Button>
                )}
                <Button
                  onClick={() => {
                    if (result.passed && result.next_level) {
                      onContinue(result.next_level.level_number);
                    } else {
                      onOpenChange(false);
                    }
                  }}
                  className="gap-2"
                >
                  {result.passed && result.next_level ? (
                    <>
                      Continue: {result.next_level.skill}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  ) : result.passed ? (
                    "Back to the map"
                  ) : (
                    "Close"
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LevelDetail;
