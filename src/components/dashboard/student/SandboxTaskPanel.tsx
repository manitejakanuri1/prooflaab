import { useEffect, useState, type ReactNode } from "react";
import Editor from "@monaco-editor/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SimpleQuestion } from "./SimpleQuestion";
import { FunctionSignature, GivenMaterial, SampleExamples } from "./GivenMaterial";
import { submitScoreLine, verdictText, type Verdict } from "@/lib/codingVerdicts";
import {
  formatArguments, formatReturn, functionSpecOf, hiddenSummaryText, isHiddenSummary, safeResultRows, type HiddenSummary,
} from "@/lib/functionSignature";
import { CheckCircle2, Loader2, Play, RotateCcw, Send, XCircle, Mic } from "lucide-react";
import { checkLine, fmtMark, loadLotState, submitLot, type LotState } from "@/lib/lotMarks";

interface SandboxView {
  task_id: string;
  title: string;
  description: string | null;
  /** "function" for implement-a-function tasks; absent or "stdio" for whole programs. */
  kind?: string | null;
  function_spec?: unknown;
  language: string;
  starter_code: string;
  constraints: string | null;
  pass_threshold: number;
  time_limit_ms: number;
  visible_tests: { id: string; stdin: string; expected_output: string }[];
  hidden_test_count: number;
  completed: boolean;
  attempts: number;
}

interface TestResult {
  id: string;
  visible: boolean;
  verdict: Verdict;
  passed: boolean;
  stdin?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
}

interface SubmitResult {
  score: number;
  pass_threshold: number;
  passed: boolean;
  failed_tests?: number;
  already_completed: boolean;
  xp_awarded: number;
  /** Daily Lots (migration 165): this check's mark out of 10 and the Lot's checks left / best mark. */
  mark?: number;
  lot?: LotState | null;
  /** Week 2 on (migration 166): one failed hidden test, from the 2nd failed check. */
  hidden_hint?: { input: string; expected: string; got: string; error: string } | null;
  /** Visible tests in detail; hidden tests only as one aggregate row. */
  results: (TestResult | HiddenSummary)[];
}

/** Reads the message the edge function wrote, instead of supabase-js's generic one. */
async function errorMessage(e: unknown): Promise<string> {
  try {
    const body = await (e as { context?: Response }).context?.json();
    if (body?.error) return body.error;
  } catch { /* not JSON */ }
  return "Something went wrong. Try again.";
}

/**
 * Classes for the DialogContent that hosts a task panel: the whole screen
 * instead of a centred box, so the question and the answer sit side by side.
 */
export const TASK_SCREEN_CLASS =
  "left-0 top-0 h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden p-0 sm:rounded-none data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0";

interface SandboxTaskPanelProps {
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
 * The editor screen for a coding-graded task (a sandbox Lot, level proof, or
 * assigned task). Runs the student's code against the visible tests on
 * demand ("Run samples") and against every test on Submit — a pass completes
 * the task and pays XP once, through record_task_submission().
 */
export default function SandboxTaskPanel({
  taskId,
  onCompleted,
  voice,
  onPassedChange,
  voiceSaved,
  onFinish,
}: SandboxTaskPanelProps) {
  const draftKey = `sandbox-draft:${taskId}`;
  const [view, setView] = useState<SandboxView | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"run" | "submit" | null>(null);
  const [runResults, setRunResults] = useState<TestResult[] | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const [tab, setTab] = useState<"testcase" | "result">("testcase");
  const [caseIndex, setCaseIndex] = useState(0);
  // A Daily Lot: 3 checks, the best counts, then "Submit this score" opens the recorder (migration 165).
  const [lot, setLot] = useState<LotState | null>(null);
  const daily = !!lot?.daily;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("sandbox_task_view" as never, { _task_id: taskId } as never);
      if (cancelled) return;
      const v = data as unknown as SandboxView | null;
      setView(v);
      let draft: string | null = null;
      try { draft = localStorage.getItem(draftKey); } catch { /* storage blocked */ }
      setCode(draft ?? v?.starter_code ?? "");
      const st = await loadLotState(taskId);
      if (!cancelled) setLot(st);
    })();
    return () => { cancelled = true; };
  }, [taskId, draftKey]);

  const saveDraft = (value: string) => {
    setCode(value);
    try { localStorage.setItem(draftKey, value); } catch { /* storage blocked */ }
  };

  const run = async () => {
    setBusy("run"); setError(null); setTab("result");
    const { data, error: e } = await supabase.functions.invoke("run-sandbox", { body: { task_id: taskId, code } });
    setBusy(null);
    if (e) return setError(await errorMessage(e));
    setRunResults((data as { results: TestResult[] }).results);
  };

  const submit = async () => {
    setBusy("submit"); setError(null); setTab("result");
    // A busy runner answers 503 BEFORE anything is stored, so sending the same code again
    // cannot duplicate or lose a submission. Retry for the student instead of asking them to.
    let data: unknown, e: unknown;
    for (let attempt = 0; ; attempt++) {
      ({ data, error: e } = await supabase.functions.invoke("submit-sandbox-task", { body: { task_id: taskId, code } }));
      if (!e || (e as { context?: Response }).context?.status !== 503 || attempt >= 3) break;
      setRetryNote(`The code runner is busy. Your code is safe - checking again (${attempt + 1} of 3)...`);
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    }
    setBusy(null); setRetryNote(null);
    if (e) {
      setError(await errorMessage(e));
      if (daily) setLot(await loadLotState(taskId));
      return;
    }
    const r = data as SubmitResult;
    setResult(r);
    if (r.lot) setLot(r.lot);
    if (r.passed || r.lot?.submitted) {
      onPassedChange?.(true);
      // Not onCompleted() here: that closes the dialog, so a pass flashed its
      // score and vanished. The Done button below closes it once it is read.
      try { localStorage.removeItem(draftKey); } catch { /* storage blocked */ }
    }
  };

  // "Submit this score": the best check counts, whatever it is, and the recorder opens.
  const submitBest = async () => {
    setBusy("submit"); setError(null);
    const st = await submitLot(taskId);
    setBusy(null);
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

  const done = view.completed || result?.passed || (daily && lot?.submitted);
  const totalTests = view.visible_tests.length + view.hidden_test_count;
  const checksLeft = lot?.checks_left ?? 0;
  // Week 2 on: check until every test passes; no Submit this score.
  const strict = daily && lot?.mode === "strict";
  // Visible rows + one hidden count at most: hidden inputs/outputs/errors/ids are never rendered.
  const shownResults = safeResultRows<TestResult>(result?.results ?? runResults);
  const spec = functionSpecOf(view);

  const testcaseTab = (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {view.visible_tests.map((t, i) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCaseIndex(i)}
            className={`rounded-md px-3 py-1 text-xs ${caseIndex === i ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/60"}`}
          >
            Case {i + 1}
          </button>
        ))}
      </div>
      {view.visible_tests[caseIndex] && (
        <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">
          {spec
            ? `arguments: ${formatArguments(view.visible_tests[caseIndex].stdin, spec)}\nexpected:  ${formatReturn(view.visible_tests[caseIndex].expected_output)}`
            : `input:    ${view.visible_tests[caseIndex].stdin}\nexpected: ${view.visible_tests[caseIndex].expected_output}`}
        </pre>
      )}
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        + {view.hidden_test_count} hidden test{view.hidden_test_count === 1 ? "" : "s"} on {daily ? "Check" : "Submit"}
      </p>
    </div>
  );

  const resultTab = (
    <div className="space-y-3">
      {busy === "submit" && (
        <p className="text-sm text-muted-foreground">{retryNote ?? "Evaluating against every test..."}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className={`rounded-lg border p-3 ${result.passed ? "border-verified/50" : "border-compete/50"}`}>
          <p className="font-semibold">
            {daily && lot
              ? result.passed
                ? `All ${totalTests} tests passed. Score 10 - submitted.`
                : `${totalTests - (result.failed_tests ?? 0)} of ${totalTests} tests passed. ${checkLine(result.mark ?? 0, lot)}`
              : submitScoreLine(result)}
            {result.xp_awarded > 0 && ` · +${result.xp_awarded} XP`}
          </p>
          {result.already_completed && !result.passed && (
            <p className="mt-1 text-sm text-muted-foreground">You already completed this task.</p>
          )}
          {result.passed && onCompleted && !voice && (
            <Button className="mt-3 w-full" onClick={onCompleted}>Next: explain it in 60 seconds</Button>
          )}

          {done && !voiceSaved && (
            <div className="mt-4 rounded-xl border-2 border-primary bg-primary/10 p-4 text-center shadow-sm animate-in fade-in">
              <div className="flex items-center justify-center gap-2 text-base font-bold text-primary">
                <Mic className="h-5 w-5 animate-pulse" />
                Step 2 of 2: Record your 60-second explanation now
              </div>
              <p className="mt-1 text-sm font-medium">
                {daily ? "Your coding mark is saved." : "Your code passed all tests!"} You cannot exit without recording your explanation.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Look at the panel on the right — click &quot;I understand — continue&quot; and explain your approach in your own words.
              </p>
            </div>
          )}

          {done && voiceSaved && (
            <div className="mt-4 rounded-xl border border-verified/50 bg-verified/10 p-4 text-center animate-in fade-in">
              <p className="flex items-center justify-center gap-2 font-semibold text-verified">
                <CheckCircle2 className="h-5 w-5" /> Task Fully Completed!
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your code submission and voice explanation have both been verified and saved.
              </p>
              {onFinish && (
                <Button
                  className="mt-3 w-full bg-verified text-primary-foreground hover:bg-verified/90 font-semibold"
                  onClick={onFinish}
                >
                  Complete &amp; Return to Dashboard
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {shownResults?.map((t, i) => isHiddenSummary(t) ? (
        <div key={t.id} className="flex items-start gap-2 text-sm">
          {t.passed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-verified" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-alert" />
          )}
          <p>{hiddenSummaryText(t)}</p>
        </div>
      ) : (
        <div key={t.id} className="flex items-start gap-2 text-sm">
          {t.passed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-verified" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-alert" />
          )}
          <div className="min-w-0">
            <p>
              Sample {i + 1}: {verdictText(t.verdict)}
            </p>
            {!t.passed && (
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                {spec
                  ? `arguments: ${formatArguments(t.stdin ?? "", spec)}\nexpected:  ${formatReturn(t.expected ?? "")}\nreturned:  ${t.actual ? formatReturn(t.actual) : "(nothing)"}${t.stderr ? `\n${t.stderr}` : ""}`
                  : `input:    ${t.stdin}\nexpected: ${t.expected}\ngot:      ${t.actual}${t.stderr ? `\n${t.stderr}` : ""}`}
              </pre>
            )}
          </div>
        </div>
      ))}

      {result?.hidden_hint && (
        <div className="rounded-lg border border-compete/50 p-3 text-sm" data-testid="lot-hidden-hint">
          <p className="font-medium">A hidden test your code failed - use it to fix your code:</p>
          <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
            {spec
              ? `arguments: ${formatArguments(result.hidden_hint.input, spec)}
expected:  ${formatReturn(result.hidden_hint.expected)}
returned:  ${result.hidden_hint.got ? formatReturn(result.hidden_hint.got) : "(nothing)"}${result.hidden_hint.error ? `
${result.hidden_hint.error}` : ""}`
              : `input:    ${result.hidden_hint.input}
expected: ${result.hidden_hint.expected}
got:      ${result.hidden_hint.got}${result.hidden_hint.error ? `
${result.hidden_hint.error}` : ""}`}
          </pre>
        </div>
      )}

      {view.completed && !result && (
        <p className="text-sm text-verified">You already completed this task.</p>
      )}
      {daily && lot?.submitted && !view.completed && !result && (
        <p className="text-sm text-verified">Submitted. Your coding mark: {fmtMark(lot.best_mark)} out of 10.</p>
      )}
      {!busy && !error && !result && !runResults && !view.completed && !(daily && lot?.submitted) && (
        <p className="text-sm text-muted-foreground">
          {strict
            ? "Press Check to test your code against every test. Check as often as you need - the voice part opens when every test passes."
            : daily
            ? `Press Check to test your code against every test. You have ${checksLeft} ${checksLeft === 1 ? "check" : "checks"} - your best one counts.`
            : "Run your code to see results here."}
        </p>
      )}
    </div>
  );

  // Full-screen split (LeetCode-style): the question on the left, the editor and
  // its tests on the right, each scrolling on its own. Narrow screens stack them.
  return (
    <div className={`flex h-full flex-col overflow-y-auto lg:grid lg:overflow-hidden ${voice ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_320px]" : "lg:grid-cols-2"}`}>
      <div className="space-y-4 border-b p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <h2 className="pr-8 text-lg font-semibold lg:pr-0">{view.title}</h2>
        <SimpleQuestion taskId={taskId} original={view.description} />
        <GivenMaterial taskId={taskId} language={view.language} />
        {spec && <FunctionSignature language={view.language} spec={spec} />}
        <SampleExamples tests={view.visible_tests} spec={spec} />
        {view.constraints && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">{view.constraints}</p>
        )}
        <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {view.language} · {daily && !strict ? `${lot?.checks_max ?? 3} checks, your best counts` : "every test must pass"} · {view.visible_tests.length} sample
          {view.visible_tests.length === 1 ? "" : "s"} + {view.hidden_test_count} hidden test
          {view.hidden_test_count === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex min-h-0 shrink-0 flex-col lg:h-full">
        <div className="flex items-center justify-between border-b px-4 py-2 pr-12">
          <span className="text-xs text-muted-foreground font-mono">Editor ({view.language})</span>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={!!busy || !!done}
            onClick={() => {
              if (window.confirm("Reset editor to starter code? Any changes you typed will be replaced.")) {
                saveDraft(view.starter_code ?? "");
              }
            }}
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset starter code
          </Button>
        </div>

        <div className="h-[360px] shrink-0 lg:h-auto lg:min-h-[200px] lg:flex-1">
          <Editor
            height="100%"
            language={view.language === "cpp" || view.language === "c" ? "cpp" : view.language}
            value={code}
            onChange={(v) => saveDraft(v ?? "")}
            theme="vs-dark"
            options={{ minimap: { enabled: false }, fontSize: 13, readOnly: !!done, scrollBeyondLastLine: false }}
          />
        </div>

        <div className="flex flex-col border-t lg:h-[42%] lg:min-h-[220px] lg:shrink-0">
          <div className="flex gap-1 border-b px-3 pt-2">
            {(["testcase", "result"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`border-b-2 px-3 pb-2 text-sm ${tab === t ? "border-primary font-semibold" : "border-transparent text-muted-foreground"}`}
              >
                {t === "testcase" ? "Testcase" : "Result"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {tab === "testcase" ? testcaseTab : resultTab}
          </div>
          <div className="flex justify-end gap-2 border-t px-4 py-3">
            {daily ? (
              <>
                {!strict && (
                  <Button variant="outline" onClick={submitBest} disabled={!!busy || !!done || !(lot?.checks_used ?? 0)}
                          data-testid="lot-submit-best">
                    <Send className="mr-2 h-4 w-4" />
                    Submit this score
                  </Button>
                )}
                <Button onClick={submit} disabled={!!busy || !!done || (!strict && checksLeft < 1)} data-testid="lot-check">
                  {busy === "submit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  {strict ? "Check" : `Check (${checksLeft} left)`}
                </Button>
              </>
            ) : (<>
            <Button variant="outline" onClick={run} disabled={!!busy || !!done}>
              {busy === "run" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run
            </Button>
            <Button onClick={submit} disabled={!!busy || !!done}>
              {busy === "submit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Submit
            </Button>
            </>)}
          </div>
        </div>
      </div>
      {voice && (
        <aside className="shrink-0 border-t p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
          {voice(!!done, onFinish)}
        </aside>
      )}
    </div>
  );
}
