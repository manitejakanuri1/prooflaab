import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { readFunctionError } from "@/lib/functionError";
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

interface LevelPayload {
  level: { id: string; track_slug: string; level_number: number; skill: string; title: string };
  explanation: string;
  quiz: QuizQuestion[];
  proof: { title: string; brief: string };
  status: string;
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
  next_level: { level_number: number; skill: string; title: string } | null;
  track_complete: boolean;
}

interface LevelDetailProps {
  trackSlug: string;
  levelNumber: number | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a pass, so the map can redraw with the new unlock. */
  onCleared: () => void;
}

type Phase = "loading" | "read" | "quiz" | "result" | "error";

const LevelDetail = ({ trackSlug, levelNumber, onOpenChange, onCleared }: LevelDetailProps) => {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorText, setErrorText] = useState("");
  const [data, setData] = useState<LevelPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitPayload | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const open = levelNumber !== null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setPhase("loading");
      setData(null);
      setResult(null);
      setAnswers({});

      const { data: payload, error } = await supabase.functions.invoke("level-open", {
        body: { track_slug: trackSlug, level_number: levelNumber },
      });

      if (cancelled) return;

      if (error) {
        const body = await readFunctionError(error);
        setErrorText(
          String(body?.error ?? "Could not open this level. Please try again in a moment."),
        );
        setPhase("error");
        return;
      }

      setData(payload as LevelPayload);
      setPhase("read");
    })();

    return () => {
      cancelled = true;
    };
  }, [open, trackSlug, levelNumber]);

  // Each phase starts a new screen's worth of content; keeping the old scroll
  // position leaves people halfway down a page they have not read yet.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [phase]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="font-mono">
              Level {levelNumber}
            </Badge>
            {data && <Badge variant="outline">{data.level.skill}</Badge>}
          </div>
          <DialogTitle className="text-xl mt-2 text-left">
            {data?.level.title ?? "Loading…"}
          </DialogTitle>
        </DialogHeader>

        <div ref={scrollRef} className="overflow-y-auto px-6 py-5 flex-1">
          {phase === "loading" && (
            <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">Writing this level…</p>
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
            <div className="space-y-5">
              {/* Paragraphs, not a lesson page. The whole thing is under 200 words
                  on purpose — this is the explanation, the quiz is the teaching. */}
              <div className="space-y-3">
                {data.explanation.split(/\n{2,}/).map((para, i) => (
                  <p key={i} className="text-[15px] leading-relaxed">
                    {para.trim()}
                  </p>
                ))}
              </div>

              <div className="rounded-lg border bg-muted/40 p-4">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Hammer className="h-4 w-4 text-primary" />
                  Then you'll build: {data.proof.title}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{data.proof.brief}</p>
              </div>

              {data.attempts > 0 && (
                <p className="text-xs text-muted-foreground">
                  You've tried this quiz {data.attempts} {data.attempts === 1 ? "time" : "times"} —
                  best {data.best_score} of 3.
                </p>
              )}
            </div>
          )}

          {phase === "quiz" && data && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Three questions. Get 2 right and the next level opens.
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
                className={`rounded-lg border p-4 ${
                  result.passed
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-amber-500/40 bg-amber-500/10"
                }`}
              >
                <p className="font-semibold flex items-center gap-2">
                  {result.passed ? (
                    <PartyPopper className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <RotateCcw className="h-5 w-5 text-amber-600" />
                  )}
                  {result.score} out of {result.out_of}
                  {result.passed ? " — level cleared" : " — not quite yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {result.passed
                    ? result.track_complete
                      ? "That was the last level on this path. Genuinely well done."
                      : `Next up: level ${result.next_level?.level_number} — ${result.next_level?.title}.`
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
                        {data.quiz[i]?.options[r.correct_index]}
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
                    It's waiting in Assigned Tasks. Finishing it earns this level its star —
                    knowing it is good, proving it is the point.
                  </p>
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

            {phase === "read" && (
              <Button onClick={() => setPhase("quiz")} className="gap-2">
                Got it — quiz me
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}

            {phase === "quiz" && (
              <Button onClick={handleSubmit} disabled={!allAnswered || submitting} className="gap-2">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {allAnswered ? "Check my answers" : "Answer all three"}
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
                <Button onClick={() => onOpenChange(false)}>
                  {result.passed ? "Back to the map" : "Close"}
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
