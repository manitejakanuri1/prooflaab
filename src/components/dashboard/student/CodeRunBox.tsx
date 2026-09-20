import { useEffect, useState } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/functionError";
import CodeEditor from "./CodeEditor";

interface CodeRunBoxProps {
  language: string; // one of the runner's languages, see runnableLanguage()
  code: string;
}

interface RunResult { status: "ok" | "compile_error" | "runtime_error" | "time_limit" | "busy"; stdout: string; stderr: string }

const NAMES: Record<string, string> = { python: "Python", javascript: "JavaScript", ruby: "Ruby", php: "PHP", c: "C", cpp: "C++", go: "Go", java: "Java" };

// The runner's messages name its temporary folder (/tmp/run-abc/main.py); a student only needs main.py.
const tidy = (t: string) => t.replace(/\/tmp\/run-[^/\s]+\//g, "").trim();

// Which line of the student's code does the error point to? (Each language words it differently.)
const LINE: Record<string, RegExp> = {
  python: /File "[^"]*main\.py", line (\d+)/g,
  javascript: /main\.js:(\d+)/g,
  ruby: /main\.rb:(\d+)/g,
  php: /on line (\d+)/g,
  c: /main\.c:(\d+):/g,
  cpp: /main\.cpp:(\d+):/g,
  go: /main\.go:(\d+):/g,
  java: /\.java:(\d+):/g,
};
function errorLineOf(language: string, stderr: string): number | null {
  const all = [...stderr.matchAll(LINE[language] ?? /$^/g)];
  if (all.length === 0) return null;
  // Python prints the whole call chain and the mistake is the last frame; the others list it first.
  return Number((language === "python" ? all[all.length - 1] : all[0])[1]) || null;
}

/**
 * A lesson's code example that can be changed and run. The code runs on ProofLab's own
 * runner (run-code function): nothing is graded or saved, the student just sees what it printed.
 */
const CodeRunBox = ({ language, code }: CodeRunBoxProps) => {
  const [text, setText] = useState(code);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // A new step brings a new example.
  useEffect(() => { setText(code); setResult(null); setProblem(null); }, [code]);

  const edit = (v: string) => { setText(v); setResult((r) => (r && r.status !== "ok" ? null : r)); };

  const run = async () => {
    if (running) return;
    setRunning(true); setResult(null); setProblem(null);
    try {
      // The runner takes a few at a time; if it says busy, wait a moment and try again.
      for (let attempt = 0; attempt < 4; attempt++) {
        const { data, error } = await supabase.functions.invoke("run-code", { body: { language, code: text } });
        if (error) {
          const body = await readFunctionError(error);
          setProblem(String(body?.error ?? "Could not run the code. Try again in a moment."));
          return;
        }
        const r = data as RunResult;
        if (r.status !== "busy" || attempt === 3) { setResult(r); return; }
        await new Promise((res) => setTimeout(res, 1500 + attempt * 1000));
      }
    } catch {
      setProblem("Could not run the code. Check your connection and try again.");
    } finally {
      setRunning(false);
    }
  };

  const failed = result?.status === "compile_error" || result?.status === "runtime_error";
  const errorLine = failed && result ? errorLineOf(language, result.stderr) : null;
  const firstError = failed && result ? tidy(result.stderr).split("\n").filter(Boolean).slice(-1)[0] : undefined;

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{NAMES[language] ?? language}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">Change it and press Run</span>
      </div>
      <CodeEditor
        value={text}
        onChange={edit}
        language={language}
        label={`${NAMES[language] ?? language} code`}
        errorLine={errorLine}
        errorText={firstError}
      />
      <div className="flex items-center gap-2 border-t bg-muted/40 px-3 py-2">
        <Button type="button" size="sm" onClick={() => void run()} disabled={running || !text.trim()}>
          {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
          {running ? "Running..." : "Run"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => { setText(code); setResult(null); setProblem(null); }}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
        </Button>
      </div>
      {(result || problem) && (
        <div className="border-t bg-[#1e1e1e] p-3 font-mono text-xs leading-relaxed" role="status">
          {problem && <p className="text-amber-300">{problem}</p>}
          {result?.status === "ok" && (
            <>
              <p className="mb-1 text-emerald-400">Ran fine.</p>
              <pre className="whitespace-pre-wrap text-[#d4d4d4]">{result.stdout.trim() ? result.stdout : "(it printed nothing)"}</pre>
            </>
          )}
          {result?.status === "compile_error" && (
            <>
              <p className="mb-1 text-red-400">Your code did not compile. {errorLine ? `The red line is line ${errorLine}. ` : ""}Read the message and fix it:</p>
              <pre className="whitespace-pre-wrap text-red-300">{tidy(result.stderr)}</pre>
            </>
          )}
          {result?.status === "runtime_error" && (
            <>
              <p className="mb-1 text-red-400">Your code stopped with an error{errorLine ? ` on line ${errorLine} (marked red)` : ""}:</p>
              {result.stdout.trim() && <pre className="whitespace-pre-wrap text-[#d4d4d4]">{result.stdout}</pre>}
              <pre className="whitespace-pre-wrap text-red-300">{tidy(result.stderr)}</pre>
            </>
          )}
          {result?.status === "time_limit" && (
            <p className="text-amber-300">It ran for more than 10 seconds, so it was stopped. Look for a loop that never ends.</p>
          )}
          {result?.status === "busy" && (
            <p className="text-amber-300">The code runner is busy right now. This is not a problem with your code. Try again in a few seconds.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default CodeRunBox;
