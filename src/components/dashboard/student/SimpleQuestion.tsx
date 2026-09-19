import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, Loader2 } from "lucide-react";
import { BriefCards, InlineText } from "./ReadableText";

interface Brief {
  in_one_line: string;
  what_it_means: string;
  steps: string[];
  example: string | null;
  words: { word: string; meaning: string }[];
  done_when: string;
}

/**
 * The task's own question, told in simple words (owner's rule, 19 Sep 2026).
 * Nothing about the task changes - the simple version is written once per
 * task text on the server, and the original wording stays one tap away
 * because that is what the answer is marked against.
 */
function useSimpleBrief(taskId: string) {
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
  return { brief, loading };
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{children}</p>
);

/** Full question for the task screens (coding and written). */
export const SimpleQuestion = ({ taskId, original }: { taskId: string; original: string | null }) => {
  const { brief, loading } = useSimpleBrief(taskId);
  const [showOriginal, setShowOriginal] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the question…
      </div>
    );
  }
  // No simple version (yet): the original question, as cards.
  if (!brief) return original ? <BriefCards text={original} /> : null;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
        <Label>Your task</Label>
        <p className="text-base font-semibold leading-snug"><InlineText text={brief.in_one_line} /></p>
        <p className="text-sm leading-relaxed"><InlineText text={brief.what_it_means} /></p>
      </div>

      <div className="rounded-lg border p-3">
        <Label>Do it in these steps</Label>
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
        <div className="rounded-lg border p-3">
          <Label>For example</Label>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed"><InlineText text={brief.example} /></p>
        </div>
      )}

      {brief.words.length > 0 && (
        <div className="rounded-lg border p-3">
          <Label>Words to know</Label>
          <dl className="mt-2 space-y-1 text-sm">
            {brief.words.map((w) => (
              <div key={w.word}><dt className="inline font-medium">{w.word}:</dt> <dd className="inline text-muted-foreground">{w.meaning}</dd></div>
            ))}
          </dl>
        </div>
      )}

      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
        <span className="font-medium">You are done when: </span><InlineText text={brief.done_when} />
      </div>

      {original && (
        <div>
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showOriginal ? "rotate-180" : ""}`} />
            {showOriginal ? "Hide original wording" : "Show original wording"}
          </button>
          {showOriginal && <div className="mt-2"><BriefCards text={original} /></div>}
        </div>
      )}
    </div>
  );
};

/** Short version for the Daily card: the one line and what it means. */
export const SimpleQuestionShort = ({ taskId, original }: { taskId: string; original: string | null }) => {
  const { brief, loading } = useSimpleBrief(taskId);
  if (loading) return <p className="text-sm text-[#6b6559]">Loading…</p>;
  if (!brief) return original ? <BriefCards text={original} tone="paper" /> : null;
  return (
    <div className="space-y-2 rounded-lg border border-[#d8d1c1] bg-[#faf7ef] p-3">
      <p className="text-sm font-semibold leading-snug"><InlineText text={brief.in_one_line} /></p>
      <p className="text-sm leading-relaxed text-[#4d4a43]"><InlineText text={brief.what_it_means} /></p>
    </div>
  );
};
