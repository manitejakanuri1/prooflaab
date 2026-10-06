import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SimpleQuestion } from "./SimpleQuestion";
import { FunctionSignature, GivenMaterial, SampleExamples } from "./GivenMaterial";
import {
  formatArguments, formatReturn, functionSpecOf, hiddenSummaryText, isHiddenSummary, safeResultRows, type HiddenSummary,
} from "@/lib/functionSignature";
import { CheckCircle2, Loader2, Play, Send, XCircle } from "lucide-react";

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
  verdict: "accepted" | "wrong_answer" | "runtime_error" | "compile_error" | "time_limit";
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
  /** Visible tests in detail; hidden tests only as one aggregate row. */
  results: (TestResult | HiddenSummary)[];
}

const VERDICT_TEXT: Record<TestResult["verdict"], string> = {
  accepted: "Passed",
  wrong_answer: "Wrong answer",
  runtime_error: "Crashed",
  compile_error: "Did not compile",
  time_limit: "Too slow",
};

/** Reads the message the edge function wrote, instead of supabase-js's generic one. */
async function errorMessage(e: unknown): Promise<string> {
  try {
    const body = await (e as { context?: Response }).context?.json();
    if (body?.error) return body.error;
  } catch { /* not JSON */ }
  return "Something went wrong. Try again.";
}

interface SandboxTaskPanelProps {
  taskId: string;
  onCompleted?: () => void;
}

/**
 * The editor screen for a coding-graded task (a sandbox Lot, level proof, or
 * assigned task). Runs the student's code against the visible tests on
 * demand ("Run samples") and against every test on Submit — a pass completes
 * the task and pays XP once, through record_task_submission().
 */
export default function SandboxTaskPanel({ taskId, onCompleted }: SandboxTaskPanelProps) {
  const draftKey = `sandbox-draft:${taskId}`;
  const [view, setView] = useState<SandboxView | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"run" | "submit" | null>(null);
  const [runResults, setRunResults] = useState<TestResult[] | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);

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
    })();
    return () => { cancelled = true; };
  }, [taskId, draftKey]);

  const saveDraft = (value: string) => {
    setCode(value);
    try { localStorage.setItem(draftKey, value); } catch { /* storage blocked */ }
  };

  const run = async () => {
    setBusy("run"); setError(null);
    const { data, error: e } = await supabase.functions.invoke("run-sandbox", { body: { task_id: taskId, code } });
    setBusy(null);
    if (e) return setError(await errorMessage(e));
    setRunResults((data as { results: TestResult[] }).results);
  };

  const submit = async () => {
    setBusy("submit"); setError(null);
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
    if (e) return setError(await errorMessage(e));
    const r = data as SubmitResult;
    setResult(r);
    if (r.passed) {
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

  const done = view.completed || result?.passed;
  // Visible rows + one hidden count at most: hidden inputs/outputs/errors/ids are never rendered.
  const shownResults = safeResultRows<TestResult>(result?.results ?? runResults);
  const spec = functionSpecOf(view);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{view.title}</h2>
        <SimpleQuestion taskId={taskId} original={view.description} />
        <GivenMaterial taskId={taskId} language={view.language} />
        {spec && <FunctionSignature language={view.language} spec={spec} />}
        <SampleExamples tests={view.visible_tests} spec={spec} />
        {view.constraints && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">{view.constraints}</p>
        )}
        <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {view.language} · every test must pass · {view.visible_tests.length} sample
          {view.visible_tests.length === 1 ? "" : "s"} + {view.hidden_test_count} hidden test
          {view.hidden_test_count === 1 ? "" : "s"}
        </p>
      </div>

      <div className="space-y-4 lg:sticky lg:top-0 lg:self-start">
      <div className="overflow-hidden rounded-lg border">
        <Editor
          height="420px"
          language={view.language === "cpp" || view.language === "c" ? "cpp" : view.language}
          value={code}
          onChange={(v) => saveDraft(v ?? "")}
          theme="vs-dark"
          options={{ minimap: { enabled: false }, fontSize: 13, readOnly: !!done, scrollBeyondLastLine: false }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={run} disabled={!!busy || !!done}>
          {busy === "run" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Run samples
        </Button>
        <Button onClick={submit} disabled={!!busy || !!done}>
          {busy === "submit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Submit
        </Button>
      </div>

      {busy === "submit" && (
        <p className="text-sm text-muted-foreground">{retryNote ?? "Evaluating against every test..."}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className={`rounded-lg border p-3 ${result.passed ? "border-emerald-500/50" : "border-amber-500/50"}`}>
          <p className="font-semibold">
            Score {result.score}% {result.passed
              ? "· Passed"
              : result.score >= result.pass_threshold && result.failed_tests
                ? `· ${result.failed_tests} test${result.failed_tests === 1 ? "" : "s"} failed - every test must pass`
                : `· Needs ${result.pass_threshold}%`}
            {result.xp_awarded > 0 && ` · +${result.xp_awarded} XP`}
          </p>
          {result.already_completed && !result.passed && (
            <p className="mt-1 text-sm text-muted-foreground">You already completed this task.</p>
          )}
          {result.passed && onCompleted && (
            <Button className="mt-3 w-full" onClick={onCompleted}>Next: explain it in 60 seconds</Button>
          )}
        </div>
      )}

      {shownResults?.map((t, i) => isHiddenSummary(t) ? (
        <div key={t.id} className="flex items-start gap-2 text-sm">
          {t.passed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          )}
          <p>{hiddenSummaryText(t)}</p>
        </div>
      ) : (
        <div key={t.id} className="flex items-start gap-2 text-sm">
          {t.passed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          )}
          <div className="min-w-0">
            <p>
              Sample {i + 1}: {VERDICT_TEXT[t.verdict]}
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

      {view.completed && !result && (
        <p className="text-sm text-emerald-600">You already completed this task.</p>
      )}
      </div>
    </div>
  );
}
