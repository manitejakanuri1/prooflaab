import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import CodeSnapshot from "./CodeSnapshot";
import { formatArguments, formatReturn, signatureLine, type FunctionSpecView } from "@/lib/functionSignature";

/** Best-effort highlight language for a pasted snippet. */
const guessLanguage = (code: string) => {
  if (/^\s*>>>|\bdef \w+\(|\bprint\(|\bimport \w+/m.test(code)) return "python";
  if (/\b(select|insert into|create table)\b/i.test(code)) return "sql";
  if (/\b(const|let|function|=>|console\.log)\b/.test(code)) return "javascript";
  return "plaintext";
};

/**
 * The material a task hands the student (a pasted session, broken code, a log).
 * It lives in tasks.code_sample. The question text points at it ("this
 * transcript", "the code below"), so without it the task cannot be done.
 */
export const GivenMaterial = ({ taskId, language }: { taskId: string; language?: string }) => {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void supabase.from("tasks").select("code_sample").eq("id", taskId).maybeSingle().then(({ data }) => {
      if (!cancelled) setCode(((data as { code_sample: string | null } | null)?.code_sample ?? "").trim() || null);
    });
    return () => { cancelled = true; };
  }, [taskId]);
  if (!code) return null;
  return (
    <div className="space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Given: use this in your answer</p>
      <CodeSnapshot language={language ?? guessLanguage(code)} code={code} />
    </div>
  );
};

/** The function a function-mode task asks the student to implement, in the task's language. */
export const FunctionSignature = ({ language, spec }: { language: string; spec: FunctionSpecView }) => (
  <div className="space-y-1">
    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Implement this function</p>
    <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{signatureLine(language, spec)}</pre>
  </div>
);

/**
 * LeetCode-style examples: the sample tests, as Input / Output blocks - or, for
 * a function-mode task (spec given), as named Arguments / Expected return.
 */
export const SampleExamples = ({ tests, spec }: {
  tests: { id: string; stdin: string; expected_output: string }[];
  spec?: FunctionSpecView | null;
}) => {
  if (!tests.length) return null;
  if (spec) {
    return (
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Examples</p>
        {tests.map((t, i) => (
          <div key={t.id} className="rounded-lg border p-3 text-sm">
            <p className="mb-1 font-medium">Example {i + 1}</p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Arguments</p>
            <pre className="mb-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{formatArguments(t.stdin, spec)}</pre>
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Expected return</p>
            <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{formatReturn(t.expected_output)}</pre>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Examples</p>
      {tests.map((t, i) => (
        <div key={t.id} className="rounded-lg border p-3 text-sm">
          <p className="mb-1 font-medium">Example {i + 1}</p>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Input</p>
          <pre className="mb-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{t.stdin || "(no input)"}</pre>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Output</p>
          <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{t.expected_output}</pre>
        </div>
      ))}
    </div>
  );
};
