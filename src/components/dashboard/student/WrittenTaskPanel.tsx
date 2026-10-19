import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SimpleQuestion } from "./SimpleQuestion";
import { GivenMaterial } from "./GivenMaterial";
import CodeRunBox from "./CodeRunBox";
import { scratchLanguage, scratchLabel, writtenSubmitBody } from "@/lib/scratchpad";
import { Loader2, Send, Clock, Mic, CheckCircle2, Code } from "lucide-react";

interface RubricView {
  task_id: string;
  title: string;
  prompt_text: string;
  criteria: { id: string; name: string; description: string; max_points: number }[];
  min_words: number;
  max_words: number;
  pass_threshold: number;
  scratch_language?: string | null;
}

interface CriterionScore {
  criterion_id: string;
  points: number;
  evidence: string;
}

interface SubmitResult {
  score: number;
  pass_threshold: number;
  status: "passed" | "failed" | "needs_review";
  already_completed: boolean;
  xp_awarded: number;
  scores: CriterionScore[];
  needs_review: boolean;
}

async function errorMessage(e: unknown): Promise<string> {
  try {
    const body = await (e as { context?: Response }).context?.json();
    if (body?.error) return body.error;
  } catch { /* not JSON */ }
  return "Something went wrong. Try again.";
}

interface WrittenTaskPanelProps {
  taskId: string;
  onCompleted?: () => void;
  /**
   * The spoken explanation, shown as a third column beside the answer. Gets
   * whether the answer has passed; replaces the "Next: explain it" button.
   */
  voice?: (unlocked: boolean, onDone?: () => void) => ReactNode;
  onPassedChange?: (passed: boolean) => void;
  voiceSaved?: boolean;
  onFinish?: () => void;
}

/**
 * The write-and-submit screen for a rubric-graded task (business/pitch Lots,
 * Writing/Research/Analysis assigned tasks, hr-behavioral/verbal-ability
 * level proofs). No "run" step — a written answer has no partial check
 * worth showing before submit, unlike code against sample tests.
 *
 * A written programming task may carry scratch_language (migration 48): then a
 * scratchpad sits between the question and the answer. It only calls run-code;
 * its code is never saved, submitted or graded.
 */
export default function WrittenTaskPanel({
  taskId,
  onCompleted,
  voice,
  onPassedChange,
  voiceSaved,
  onFinish,
}: WrittenTaskPanelProps) {
  const draftKey = `written-draft:${taskId}`;
  const [view, setView] = useState<RubricView | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // task_rubric_config is admin-only RLS, so a student reads it only
      // through this security-definer function (rubric_task_view), the
      // same pattern sandbox_task_view uses for hidden tests.
      const { data } = await supabase.rpc("rubric_task_view" as never, { _task_id: taskId } as never);
      if (cancelled) return;
      setView(data as unknown as RubricView | null);
      let draft: string | null = null;
      try { draft = localStorage.getItem(draftKey); } catch { /* storage blocked */ }
      if (draft) setAnswer(draft);
    })();
    return () => { cancelled = true; };
  }, [taskId, draftKey]);

  const saveDraft = (value: string) => {
    setAnswer(value);
    try { localStorage.setItem(draftKey, value); } catch { /* storage blocked */ }
  };

  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;
  const tooShort = view ? wordCount < view.min_words : false;
  const tooLong = view ? wordCount > view.max_words : false;

  const submit = async () => {
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.functions.invoke("submit-written-task", {
      body: writtenSubmitBody(taskId, answer),
    });
    setBusy(false);
    if (e) return setError(await errorMessage(e));
    const r = data as SubmitResult;
    setResult(r);
    if (r.status === "passed") {
      onPassedChange?.(true);
      // Not onCompleted() here: that closes the dialog, so a pass flashed its
      // score and vanished. The Done button below closes it once it is read.
      try { localStorage.removeItem(draftKey); } catch { /* storage blocked */ }
    }
  };

  if (!view) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const done = result?.status === "passed";
  const scratch = scratchLanguage(view.scratch_language);

  // Full-screen split: the question and how it is marked on the left, the
  // answer on the right, each scrolling on its own. Narrow screens stack them.
  return (
    <div className={`flex h-full flex-col overflow-y-auto lg:grid lg:overflow-hidden ${voice ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_320px]" : "lg:grid-cols-2"}`}>
    <div className="space-y-4 border-b p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
      <div>
        <h2 className="pr-8 text-lg font-semibold lg:pr-0">{view.title}</h2>
        <div className="mt-3"><SimpleQuestion taskId={taskId} original={view.prompt_text} /></div>
        <div className="mt-3"><GivenMaterial taskId={taskId} /></div>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          pass mark {view.pass_threshold}% · {view.min_words}–{view.max_words} words
        </p>
      </div>

      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">How it is marked</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {view.criteria.map((c) => (
            <div key={c.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary">{c.max_points} pts</span>
              </div>
              <p className="mt-1 text-muted-foreground">{c.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="flex min-h-0 shrink-0 flex-col gap-4 p-5 lg:overflow-y-auto">
      {scratch && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">{scratchLabel(scratch)} Scratchpad</p>
          <p className="text-xs text-muted-foreground">For trying ideas only — not marked or saved.</p>
          <CodeRunBox language={scratch} code="" />
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{scratch ? "Written answer" : "Your Answer"}</p>
        {!done && !answer.trim() && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 border-dashed text-primary hover:text-primary"
            onClick={() => {
              const isTimerOrExecution = /settimeout|timer|execution order|console\.log/i.test(view.prompt_text);
              const isGenericCode = /code|snippet|function|example/i.test(view.prompt_text);
              const template = isTimerOrExecution
                ? `// Example 1:\n// (Write your JavaScript snippet here, e.g. with setTimeout / console.log)\n\nExpected Execution Order:\n// (Write your predicted execution order here)\n\nExplanation:\n// (Explain why in plain English)\n\n\n// Example 2:\n// (Write your JavaScript snippet here)\n\nExpected Execution Order:\n// (Write your predicted execution order here)\n\nExplanation:\n// (Explain why in plain English)\n\n\n// Example 3:\n// (Write your JavaScript snippet here)\n\nExpected Execution Order:\n// (Write your predicted execution order here)\n\nExplanation:\n// (Explain why in plain English)\n`
                : isGenericCode
                ? `// Example 1:\n// (Write your code snippet here)\n\nExpected Output / Behavior:\n// (Write predicted output here)\n\nExplanation:\n// (Explain your reasoning here in plain English)\n\n\n// Example 2:\n// (Write your code snippet here)\n\nExpected Output / Behavior:\n// (Write predicted output here)\n\nExplanation:\n// (Explain your reasoning here in plain English)\n`
                : `1. Approach & Reasoning:\n// (Write your explanation here)\n\n2. Key Decisions & Tradeoffs:\n// (Write your thoughts here)\n`;
              saveDraft(template);
            }}
          >
            <Code className="h-3.5 w-3.5" /> Insert example format
          </Button>
        )}
      </div>
      <Textarea
        value={answer}
        onChange={(e) => saveDraft(e.target.value)}
        readOnly={done}
        rows={12}
        placeholder="Write your answer here..."
        className="min-h-[240px] font-normal lg:flex-1"
      />
      <p className={`text-xs ${tooShort || tooLong ? "text-amber-600" : "text-muted-foreground"}`}>
        {wordCount} words {tooShort ? `(need ${view.min_words - wordCount} more)` : tooLong ? "(too long)" : ""}
      </p>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy || done || tooShort || tooLong || !answer.trim()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Submit
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div
          className={`rounded-lg border p-3 ${
            result.status === "passed"
              ? "border-emerald-500/50"
              : result.status === "needs_review"
              ? "border-blue-500/50"
              : "border-amber-500/50"
          }`}
        >
          {result.status === "needs_review" ? (
            <p className="flex items-center gap-2 font-semibold">
              <Clock className="h-4 w-4" /> Sent for review — a reviewer will check this by hand.
            </p>
          ) : (
            <p className="font-semibold">
              Score {result.score}% {result.status === "passed" ? "· Passed" : `· Needs ${result.pass_threshold}%`}
              {result.xp_awarded > 0 && ` · +${result.xp_awarded} XP`}
            </p>
          )}
          {result.status !== "needs_review" && (
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {result.scores.map((s) => {
                const c = view.criteria.find((x) => x.id === s.criterion_id);
                return (
                  <li key={s.criterion_id}>
                    {c?.name ?? s.criterion_id}: {s.points}/{c?.max_points ?? "?"}
                    {s.evidence && <span className="italic"> — "{s.evidence}"</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {result.status === "passed" && onCompleted && !voice && (
            <Button className="mt-3 w-full" onClick={onCompleted}>Next: explain it in 60 seconds</Button>
          )}

          {done && !voiceSaved && (
            <div className="mt-4 rounded-xl border-2 border-primary bg-primary/10 p-4 text-center shadow-sm animate-in fade-in">
              <div className="flex items-center justify-center gap-2 text-base font-bold text-primary">
                <Mic className="h-5 w-5 animate-pulse" />
                Step 2 of 2: Record your 60-second explanation now
              </div>
              <p className="mt-1 text-sm font-medium">
                Your written answer passed! You cannot exit without recording your explanation.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Look at the panel on the right — click &quot;I understand — continue&quot; and explain your work in your own words.
              </p>
            </div>
          )}

          {done && voiceSaved && (
            <div className="mt-4 rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-center animate-in fade-in">
              <p className="flex items-center justify-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" /> Task Fully Completed!
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your written answer and voice explanation have both been verified and saved.
              </p>
              {onFinish && (
                <Button
                  className="mt-3 w-full bg-emerald-600 text-white hover:bg-emerald-700 font-semibold"
                  onClick={onFinish}
                >
                  Complete &amp; Return to Dashboard
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
      {voice && (
        <aside className="shrink-0 border-t p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
          {voice(!!done, onFinish)}
        </aside>
      )}
    </div>
  );
}
