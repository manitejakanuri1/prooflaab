import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SimpleQuestion } from "./SimpleQuestion";
import { GivenMaterial } from "./GivenMaterial";
import CodeRunBox from "./CodeRunBox";
import { scratchLanguage, scratchLabel, writtenSubmitBody } from "@/lib/scratchpad";
import { Loader2, Send, Clock } from "lucide-react";

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
export default function WrittenTaskPanel({ taskId, onCompleted }: WrittenTaskPanelProps) {
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{view.title}</h2>
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

      {scratch && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">{scratchLabel(scratch)} Scratchpad</p>
          <p className="text-xs text-muted-foreground">For trying ideas only — not marked or saved.</p>
          <CodeRunBox language={scratch} code="" />
        </div>
      )}

      {scratch && <p className="text-sm font-semibold">Written answer</p>}
      <Textarea
        value={answer}
        onChange={(e) => saveDraft(e.target.value)}
        readOnly={done}
        rows={12}
        placeholder="Write your answer here..."
        className="font-normal"
      />
      <p className={`text-xs ${tooShort || tooLong ? "text-amber-600" : "text-muted-foreground"}`}>
        {wordCount} words {tooShort ? `(need ${view.min_words - wordCount} more)` : tooLong ? "(too long)" : ""}
      </p>

      <Button onClick={submit} disabled={busy || done || tooShort || tooLong || !answer.trim()}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
        Submit
      </Button>

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
          {result.status === "passed" && onCompleted && (
            <Button className="mt-3 w-full" onClick={onCompleted}>Next: explain it in 60 seconds</Button>
          )}
        </div>
      )}
    </div>
  );
}
