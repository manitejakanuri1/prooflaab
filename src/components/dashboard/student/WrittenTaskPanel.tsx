import { useEffect, useState, type ReactNode } from "react";
import type { VoiceStatus } from "@/lib/voiceStatusText";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SimpleQuestion } from "./SimpleQuestion";
import { GivenMaterial } from "./GivenMaterial";
import CodeRunBox from "./CodeRunBox";
import { scratchLanguage, scratchLabel, writtenSubmitBody } from "@/lib/scratchpad";
import { Loader2, Send, Clock, Mic, CheckCircle2, Play } from "lucide-react";
import { checkLine, fmtMark, loadLotState, submitLot, type LotState, of10 } from "@/lib/lotMarks";
import { toast } from "sonner";
import { savedResultLine, type SavedRow } from "@/lib/savedAnswer";
import { loadSavedAnswer } from "@/lib/savedAnswerLoad";
import { lotStatusText, part10, quotes } from "@/lib/lotText";

/**
 * Retest R2 (11 Nov 2026): the box used to show made-up headings ("Overview & Steps", "What is Tested") that did not
 * fit most Lots. It now shows a neutral hint with the checker's range. An old draft that is just a template is dropped.
 */
const OLD_TEMPLATE = /^\s*(\/\/ Example 1:|1\. Overview & Steps:)[\s\S]*\/\/ \(/;

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
  to_improve?: string;
}

interface SubmitResult {
  score: number;
  pass_threshold: number;
  status: "passed" | "failed" | "needs_review";
  already_completed: boolean;
  xp_awarded: number;
  scores: CriterionScore[];
  needs_review: boolean;
  /** Daily Lots (migration 165): this check's mark out of 10 and the Lot's checks left / best mark. */
  mark?: number;
  lot?: LotState | null;
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
  /** MF-114: the server's verdict on the recording; "Fully Completed" only when scored. */
  voiceStatus?: VoiceStatus | null;
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
  voiceStatus,
  onFinish,
}: WrittenTaskPanelProps) {
  const draftKey = `written-draft:${taskId}`;
  const [view, setView] = useState<RubricView | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  // MF-020: a finished task shows the saved answer and result from the server, not an empty box.
  const [saved, setSaved] = useState<{ row: SavedRow; voice: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A written Daily Lot: 2 checks, the best counts, then "Submit this score" opens the recorder (migration 165).
  const [lot, setLot] = useState<LotState | null>(null);
  const daily = !!lot?.daily;

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
      // A draft that is still the old inserted template (it has its "// (...)" hints) is not an answer.
      if (draft && !(OLD_TEMPLATE.test(draft) && draft.split("\n").filter((l) => l.trim() && !/^\/\/ \(|:$/.test(l.trim())).length === 0)) setAnswer(draft);
      const st = await loadLotState(taskId);
      if (!cancelled) setLot(st);
      const s = await loadSavedAnswer(taskId);
      if (!cancelled && s && (s.row.status === "passed" || st?.submitted)) {
        setSaved(s);
        if (s.row.code) setAnswer(s.row.code);
      }
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
    if (e) {
      setError(await errorMessage(e));
      if (daily) setLot(await loadLotState(taskId));
      return;
    }
    const r = data as SubmitResult;
    setResult(r);
    if (r.lot) setLot(r.lot);
    if (r.status === "passed" || r.lot?.submitted) {
      onPassedChange?.(true);
      // Not onCompleted() here: that closes the dialog, so a pass flashed its
      // score and vanished. The Done button below closes it once it is read.
      try { localStorage.removeItem(draftKey); } catch { /* storage blocked */ }
    }
  };

  // "Submit this score": the best check counts, whatever it is, and the recorder opens.
  const submitBest = async () => {
    setBusy(true); setError(null);
    const st = await submitLot(taskId);
    setBusy(false);
    if (!st) return setError("Could not submit. Try again.");
    setLot(st);
    if (st.submitted) {
      onPassedChange?.(true);
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

  const done = result?.status === "passed" || (daily && lot?.submitted) || !!saved;
  const checksLeft = lot?.checks_left ?? 0;
  // Week 2 on (migration 166): one check, its score is final and the recorder opens straight after.
  const strict = daily && lot?.mode === "strict";
  const scratch = scratchLanguage(view.scratch_language);

  // Full-screen split: the question and how it is marked on the left, the
  // answer on the right, each scrolling on its own. Narrow screens stack them.
  return (
    <div className={`flex h-full flex-col overflow-y-auto lg:grid lg:overflow-hidden ${voice ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_320px]" : "lg:grid-cols-2"}`}>
    <div className="space-y-4 border-b p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
      <div>
        <h2 className="pr-8 text-lg font-semibold lg:pr-0">{view.title}</h2>
        <div className="mt-3">
          <SimpleQuestion taskId={taskId} original={view.prompt_text} words={{ min: view.min_words, max: view.max_words }}
            moreHelp={
              // Lot screen simplify: the marking parts, the check rule and the writing tip, one tap away.
              <div className="space-y-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">What the answer is marked on</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                    {view.criteria.map((c) => <li key={c.id}>{c.name}</li>)}
                  </ul>
                </div>
                <p className="text-muted-foreground">
                  {daily ? (strict ? "One check - its score is final." : `${lot?.checks_max ?? 2} checks - your best one counts.`) : ""} Pass: {of10(view.pass_threshold)}.
                  {" "}Write in your own words; plain, everyday language is fine.
                </p>
              </div>
            }>
            <GivenMaterial taskId={taskId} />
            {/* QA round 2 item 3: the two marks; the word range is said here and nowhere else. */}
            <p className="text-sm font-medium" data-testid="marked-out-of-10">
              Answer out of 10 · Voice out of 10 · {view.min_words}–{view.max_words} words
            </p>
          </SimpleQuestion>
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
      </div>
      <Textarea
        id="written-answer"
        value={answer}
        onChange={(e) => saveDraft(e.target.value)}
        readOnly={done}
        rows={12}
        placeholder="Write your answer here."
        className="min-h-[240px] font-normal lg:flex-1"
      />
      <p className={`text-xs ${tooShort || tooLong ? "text-compete" : "text-muted-foreground"}`}>
        {wordCount} words {tooShort ? `(need ${view.min_words - wordCount} more)` : tooLong ? "(too long)" : ""}
      </p>

      {/* QA week 8: say why Check is greyed out, next to the button. */}
      {!done && (tooShort || tooLong) && answer.trim() && (
        <p className="text-right text-xs text-compete" data-testid="check-disabled-why">
          {tooShort
            ? `Check opens at ${view.min_words} words. Write ${view.min_words - wordCount} more.`
            : `Your answer is over ${view.max_words} words. Shorten it to check.`}
        </p>
      )}
      {/* Overnight TEST 12 Nov items 6-7: the pass mark next to Check; a click on a greyed-out Check says why. */}
      <div className="flex items-center justify-end gap-2"
           onClickCapture={(e) => {
             if (!done && (tooShort || tooLong) && (e.target as HTMLElement).closest("[data-testid=lot-check-wrap]")) {
               toast.info(tooShort ? `Write ${view.min_words - wordCount} more words, then press Check.` : `Shorten your answer to ${view.max_words} words, then press Check.`);
               document.getElementById("written-answer")?.focus();
             }
           }}>
        <span className="mr-auto text-xs text-muted-foreground" data-testid="pass-mark">Pass: {of10(view.pass_threshold)}</span>
        {daily ? (
          <>
            {!strict && (
              <Button variant="outline" onClick={submitBest} disabled={busy || !!done || !(lot?.checks_used ?? 0)}
                      data-testid="lot-submit-best">
                <Send className="mr-2 h-4 w-4" />
                Submit this score
              </Button>
            )}
            <span data-testid="lot-check-wrap">
              <Button onClick={submit} disabled={busy || !!done || checksLeft < 1 || tooShort || tooLong || !answer.trim()}
                      data-testid="lot-check">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Check ({checksLeft} left)
              </Button>
            </span>
          </>
        ) : (
          <Button onClick={submit} disabled={busy || done || tooShort || tooLong || !answer.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Submit
          </Button>
        )}
      </div>
      {saved && !result && (
        <p className="text-sm text-verified" data-testid="saved-answer">{savedResultLine(saved.row, "written", saved.voice)}</p>
      )}
      {daily && lot?.submitted && !result && !saved && (
        <p className="text-sm text-verified" data-testid="lot-status">
          {lotStatusText({ passed: Number(lot.best_mark ?? 0) * 10 >= view.pass_threshold, submitted: true, mark10: lot.best_mark })}
        </p>
      )}
      {daily && !lot?.submitted && !result && (
        <p className="text-xs text-muted-foreground">
          {strict
            ? "Press Check to have your answer marked. You have one check - its score is final, then you explain it out loud."
            : `Press Check to have your answer marked. You have ${checksLeft} ${checksLeft === 1 ? "check" : "checks"} - your best one counts.`}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div
          className={`rounded-lg border p-3 ${
            result.status === "passed"
              ? "border-verified/50"
              : result.status === "needs_review"
              ? "border-primary/50"
              : "border-compete/50"
          }`}
        >
          {result.status === "needs_review" ? (
            <p className="flex items-center gap-2 font-semibold">
              <Clock className="h-4 w-4" /> Sent for review — a reviewer will check this by hand.
            </p>
          ) : (
            <p className="font-semibold">
              {daily && lot
                ? `Answer ${fmtMark(result.mark)}/10. ${result.status === "passed" ? "Passed - submitted." : checkLine(result.mark ?? 0, lot)}`
                : `Answer ${of10(result.score)} ${result.status === "passed" ? "· Passed" : `· Needs ${of10(result.pass_threshold)}`}`}
            </p>
          )}
          {result.status !== "needs_review" && (
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {result.scores.map((s) => {
                const c = view.criteria.find((x) => x.id === s.criterion_id);
                return (
                  <li key={s.criterion_id}>
                    {c?.name ?? s.criterion_id}: {part10(s.points, c?.max_points)}
                    {s.evidence && <span className="italic"> — {quotes(s.evidence)}</span>}
                    {s.to_improve && !(c?.max_points != null && s.points >= c.max_points) && <div data-testid="to-improve">To improve: {s.to_improve}</div>}
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
              {voiceStatus === "failed" && (
                <p className="mt-1 text-sm font-semibold text-destructive" data-testid="voice-not-counted">
                  Your last recording was not counted: it was too short, silent or not about this task. Please record again.
                </p>
              )}
              <p className="mt-1 text-sm font-medium">
                {daily ? "Your mark is saved." : "Your written answer passed!"} Record now, or close this and record later from the Daily Card.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use the recorder on this screen (beside your answer, or below it on a phone) to explain your work in your own words.
              </p>
            </div>
          )}

          {done && voiceSaved && voiceStatus !== "scored" && (
            <div className="mt-4 rounded-xl border p-4 text-center animate-in fade-in" data-testid="voice-checking">
              <p className="font-semibold">Recording saved. We are checking it now.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The task counts as done once your explanation is scored. Your marks appear on the Daily Card.
              </p>
              {onFinish && (
                <Button className="mt-3 w-full" variant="outline" onClick={onFinish}>Return to Dashboard</Button>
              )}
            </div>
          )}

          {done && voiceSaved && voiceStatus === "scored" && (
            <div className="mt-4 rounded-xl border border-verified/50 bg-verified/10 p-4 text-center animate-in fade-in">
              <p className="flex items-center justify-center gap-2 font-semibold text-verified">
                <CheckCircle2 className="h-5 w-5" /> Task Fully Completed!
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your written answer and voice explanation have both been verified and saved.
              </p>
              {/* Retest G1: the recorder beside this shows the one "All Done - Return to Dashboard" button. */}
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
