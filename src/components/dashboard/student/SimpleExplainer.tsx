import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Lightbulb } from "lucide-react";
import { InlineText } from "./ReadableText";

interface Brief {
  in_one_line: string;
  what_it_means: string;
  steps: string[];
  example: string | null;
  words: { word: string; meaning: string }[];
  done_when: string;
}

/**
 * "Explained simply": the question retold in plain words before the student
 * starts - what it asks, the steps, a tiny example, hard words. Written once
 * per task text on the server and shared; shows nothing if it cannot load.
 */
const SimpleExplainer = ({ taskId }: { taskId: string }) => {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.functions.invoke("task-explain", { body: { task_id: taskId } }).then(
      ({ data }) => { if (!cancelled) { setBrief((data as { brief: Brief | null } | null)?.brief ?? null); setLoading(false); } },
      () => { if (!cancelled) setLoading(false); },
    );
    return () => { cancelled = true; };
  }, [taskId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Getting the simple explanation…
      </div>
    );
  }
  if (!brief) return null;

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
        <Lightbulb className="h-3.5 w-3.5" /> Explained simply
      </p>
      <p className="text-base font-semibold leading-snug"><InlineText text={brief.in_one_line} /></p>
      <p className="text-sm leading-relaxed"><InlineText text={brief.what_it_means} /></p>

      <div className="rounded-lg border bg-card p-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Do it in these steps</p>
        <ol className="mt-2 space-y-1.5 text-sm">
          {brief.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] text-primary">{i + 1}</span>
              <span className="leading-relaxed"><InlineText text={s} /></span>
            </li>
          ))}
        </ol>
      </div>

      {brief.example && (
        <div className="rounded-lg border bg-card p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">For example</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed"><InlineText text={brief.example} /></p>
        </div>
      )}

      {brief.words.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Words to know</p>
          <dl className="mt-2 space-y-1 text-sm">
            {brief.words.map((w) => (
              <div key={w.word}><dt className="inline font-medium">{w.word}:</dt> <dd className="inline text-muted-foreground">{w.meaning}</dd></div>
            ))}
          </dl>
        </div>
      )}

      <p className="text-sm"><span className="font-medium">You are done when: </span><InlineText text={brief.done_when} /></p>
    </div>
  );
};

export default SimpleExplainer;
