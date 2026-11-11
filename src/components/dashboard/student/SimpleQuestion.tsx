import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, Loader2 } from "lucide-react";
import { BriefCards, InlineText } from "./ReadableText";
import { dropHelper, oneRange } from "@/lib/lotText";

interface Brief {
  in_one_line: string;
  what_it_means: string;
  steps: string[];
  example: string | null;
  words: { word: string; meaning: string }[];
  done_when: string;
}

type Words = { min: number; max: number } | null | undefined;

/**
 * The task's own question, told in simple words (owner's rule, 19 Sep 2026).
 * Nothing about the task changes - the simple version is written once per
 * task text on the server, and the original wording stays one tap away
 * because that is what the answer is marked against.
 *
 * QA round 2 (11 Nov 2026): the simple version "never loaded" for some students. The original shows at
 * once; after 15 s the spinner stops but a late reply still swaps in, and a failed one offers Try again.
 */
function useSimpleBrief(taskId: string) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let gone = false;
    setLoading(true); setFailed(false);
    const giveUp = setTimeout(() => { if (!gone) setLoading(false); }, 15000);
    supabase.functions.invoke("task-explain", { body: { task_id: taskId } }).then(
      ({ data }) => {
        if (gone) return;
        clearTimeout(giveUp);
        const b = (data as { brief: Brief | null } | null)?.brief ?? null;
        setBrief(b); setFailed(!b); setLoading(false);
      },
      () => { if (!gone) { clearTimeout(giveUp); setFailed(true); setLoading(false); } },
    );
    return () => { gone = true; clearTimeout(giveUp); };
  }, [taskId, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { brief, loading, failed, retry };
}

/** The brief as the student sees it: the checker's word range only, no leaked prompt text (items 6, 7). */
function tidyBrief(b: Brief, words: Words): Brief {
  const t = (s: string) => oneRange(dropHelper(s), words);
  return {
    in_one_line: t(b.in_one_line), what_it_means: t(b.what_it_means), steps: b.steps.map(t).filter(Boolean),
    example: b.example ? t(b.example) : null, words: b.words, done_when: t(b.done_when),
  };
}

/**
 * The simple version is written by a model and sometimes drops a rule the tests check (on staging,
 * 19 Oct 2026, a grade Lot kept "90 to 100 is A, and so on" and lost the B/C/D/F bands). Every
 * number in the original that the simple version does not mention comes back as the original
 * sentence it sits in, so nothing the answer is marked against is hidden.
 */
function missingRules(original: string | null, shown: string): string[] {
  if (!original) return [];
  const have = new Set(shown.match(/\d+/g) ?? []);
  // Cut at a sentence end, a blank line, or before a labelled line ("Output:", "Why:"), so an example's
  // answer lines stay with their label (3 Nov 2026: "Output: 85000" lost its "Yes").
  const sentences = original.split(/(?<=[.!?])\s+|\n{2,}|\n(?=[A-Z][A-Za-z ]{0,30}:)/).map((x) => x.trim()).filter(Boolean);
  return sentences.filter((x) => (x.match(/\d+/g) ?? []).some((n) => !have.has(n))).slice(0, 4);
}

const ExactRules = ({ rules, tone }: { rules: string[]; tone?: "paper" }) =>
  rules.length === 0 ? null : (
    <div className={`rounded-lg border p-3 ${tone === "paper" ? "border-[#d8d1c1] bg-[#faf7ef]" : "border-compete/30 bg-compete/5"}`}
         data-testid="exact-rules">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">What you must do</p>
      <ul className="mt-1 space-y-1 text-sm">
        {rules.map((r) => <li key={r}><InlineText text={r} /></li>)}
      </ul>
    </div>
  );

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{children}</p>
);

const NotReady = ({ retry }: { retry: () => void }) => (
  <p className="text-xs text-muted-foreground" data-testid="simple-retry">
    The simpler version is not ready.{" "}
    <button type="button" onClick={retry} className="underline hover:text-foreground">Try again</button>
  </p>
);

/**
 * Full question for the task screens (coding and written). QA round 2 item 4: one line of what to do,
 * numbered steps, one example and "You're done when"; the longer explanation and hard words sit behind a link.
 */
export const SimpleQuestion = ({ taskId, original, words, coding }: {
  taskId: string; original: string | null; words?: Words; coding?: boolean;
}) => {
  const { brief: raw, loading, failed, retry } = useSimpleBrief(taskId);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const shownOriginal = original ? oneRange(dropHelper(original), words) : null;

  // QA week 8 (N1, N2): the simple version can take 10-20 s the first time. Show the original question
  // at once, and swap in the simple version when it is ready, so nobody waits on a spinner.
  if (!raw) {
    if (!shownOriginal) return null;
    return (
      <div className="space-y-2">
        <BriefCards text={shownOriginal} />
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Writing a simpler version of this question…
          </p>
        ) : failed ? <NotReady retry={retry} /> : null}
      </div>
    );
  }
  const brief = tidyBrief(raw, words);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <Label>{coding ? "What to build" : "What to write"}</Label>
        <p className="mt-1 text-base font-semibold leading-snug"><InlineText text={brief.in_one_line} /></p>
      </div>

      <ExactRules rules={missingRules(shownOriginal, [brief.in_one_line, brief.what_it_means, ...brief.steps,
        brief.example ?? "", brief.done_when].join(" "))} />

      <div className="rounded-lg border p-3">
        <Label>Steps</Label>
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
          <Label>Example</Label>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed"><InlineText text={brief.example} /></p>
        </div>
      )}

      <div className="rounded-lg border border-verified/30 bg-verified/5 p-3 text-sm">
        <span className="font-medium">You&apos;re done when: </span><InlineText text={brief.done_when} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" onClick={() => setShowMore((v) => !v)} data-testid="words-to-know"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMore ? "rotate-180" : ""}`} />
          {brief.words.length > 0 ? "Words to know" : "More detail"}
        </button>
        {shownOriginal && (
          <button type="button" onClick={() => setShowOriginal((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showOriginal ? "rotate-180" : ""}`} />
            {showOriginal ? "Hide original wording" : "Show original wording"}
          </button>
        )}
      </div>
      {showMore && (
        <div className="rounded-lg border p-3 text-sm space-y-2">
          <p className="leading-relaxed"><InlineText text={brief.what_it_means} /></p>
          {brief.words.length > 0 && (
            <dl className="space-y-1">
              {brief.words.map((w) => (
                <div key={w.word}><dt className="inline font-medium">{w.word}:</dt> <dd className="inline text-muted-foreground">{w.meaning}</dd></div>
              ))}
            </dl>
          )}
        </div>
      )}
      {showOriginal && shownOriginal && <BriefCards text={shownOriginal} />}
    </div>
  );
};

/** Short version for the Daily card: the one line and what it means. */
export const SimpleQuestionShort = ({ taskId, original, words }: { taskId: string; original: string | null; words?: Words }) => {
  const { brief: raw } = useSimpleBrief(taskId);
  const shownOriginal = original ? oneRange(dropHelper(original), words) : null;
  if (!raw) return shownOriginal ? <BriefCards text={shownOriginal} tone="paper" /> : null;
  const brief = tidyBrief(raw, words);
  return (
    <div className="space-y-2">
      <div className="space-y-2 rounded-lg border border-[#d8d1c1] bg-[#faf7ef] p-3">
        <p className="text-sm font-semibold leading-snug"><InlineText text={brief.in_one_line} /></p>
        <p className="text-sm leading-relaxed text-[#4d4a43]"><InlineText text={brief.what_it_means} /></p>
      </div>
      <ExactRules tone="paper" rules={missingRules(shownOriginal, `${brief.in_one_line} ${brief.what_it_means}`)} />
    </div>
  );
};
