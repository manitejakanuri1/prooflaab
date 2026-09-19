import { Fragment } from "react";

/** Text with `backtick` spans shown as inline code. No markdown library needed. */
export const InlineText = ({ text }: { text: string }) => (
  <>
    {text.split(/(`[^`]+`)/g).map((part, i) =>
      part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )}
  </>
);

/** A lesson step: one numbered card per paragraph instead of a wall of text. */
export const ParagraphCards = ({ text }: { text: string }) => {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="space-y-3">
      {paras.map((para, i) => (
        <div key={i} className="flex gap-3 rounded-lg border bg-card p-4 shadow-sm">
          {paras.length > 1 && (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-semibold text-primary">
              {i + 1}
            </span>
          )}
          <p className="text-[15px] leading-relaxed">
            <InlineText text={para} />
          </p>
        </div>
      ))}
    </div>
  );
};

const sentences = (text: string) =>
  text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9`"'(])/).map((s) => s.trim()).filter(Boolean);

const HAND_IN = /\b(when you are done|when you're done|hand (it |them )?back|hand in|submit|deliver|your answer should|return (a|the))\b/i;
const TODO = /\b(your job|your task|you need to|you must|you will|you'll|open |write |build |find |fix |explain |list |run |create |design |compare |identify )/i;

/**
 * A Lot brief split into three cards - the situation, what to do, what to hand
 * in - by plain sentence rules. Nothing is rewritten; a brief that does not
 * split cleanly still shows whole in the first card.
 */
export const BriefCards = ({ text, tone = "default" }: { text: string; tone?: "default" | "paper" }) => {
  const groups: { title: string; items: string[] }[] = [
    { title: "The situation", items: [] },
    { title: "What to do", items: [] },
    { title: "What to hand in", items: [] },
  ];
  let stage = 0;
  // Keep the brief's own line breaks: numbered lists written by hand stay lists.
  const lines = text.includes("\n") ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean) : sentences(text);
  for (const s of lines) {
    if (HAND_IN.test(s)) stage = 2;
    else if (stage === 0 && TODO.test(s)) stage = 1;
    groups[stage].items.push(s);
  }
  const card = tone === "paper" ? "border-[#d8d1c1] bg-[#faf7ef]" : "bg-card";
  const label = tone === "paper" ? "text-[#6b6559]" : "text-muted-foreground";
  return (
    <div className="space-y-2">
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.title} className={`rounded-lg border p-3 ${card}`}>
          <p className={`font-mono text-[10px] uppercase tracking-widest ${label}`}>{g.title}</p>
          {g.items.length === 1 || g.title === "The situation" ? (
            <p className="mt-1 text-sm leading-relaxed"><InlineText text={g.items.join(" ")} /></p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm leading-relaxed">
              {g.items.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span><InlineText text={s.replace(/^\s*(\d+[.)]|[-•*])\s*/, "")} /></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};
