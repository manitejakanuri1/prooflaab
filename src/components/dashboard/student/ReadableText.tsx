import { Fragment } from "react";
import CodeSnapshot from "./CodeSnapshot";

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

/** `code` and **bold** inside a line. */
const RichLine = ({ text }: { text: string }) => (
  <>
    {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong key={i}><InlineText text={part.slice(2, -2)} /></strong>
      ) : (
        <InlineText key={i} text={part} />
      ),
    )}
  </>
);

/**
 * Just enough Markdown for repo sections: paragraphs, sub-headings, lists,
 * quotes, tables as plain rows, and code blocks. Links and images were already
 * stripped when the section was collected.
 */
export const MarkdownLite = ({ text }: { text: string }) => {
  const blocks = text.split(/(```[^\n]*\n[\s\S]*?```)/g);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, bi) => {
        const fence = block.match(/^```([^\n]*)\n([\s\S]*?)```$/);
        if (fence) {
          return <CodeSnapshot key={bi} language={fence[1].trim() || "text"} code={fence[2].replace(/\n$/, "")} />;
        }
        return block.split(/\n{2,}/).map((para, pi) => {
          const lines = para.split("\n").filter((l) => l.trim());
          if (!lines.length) return null;
          const key = `${bi}-${pi}`;
          const head = lines[0].match(/^#{1,6}\s+(.*)$/);
          if (head && lines.length === 1) return <p key={key} className="pt-1 font-semibold"><RichLine text={head[1]} /></p>;
          if (lines.every((l) => /^\s*([-*+]|\d+[.)])\s+/.test(l))) {
            return (
              <ul key={key} className="space-y-1 pl-1">
                {lines.map((l, li) => (
                  <li key={li} className="flex gap-2"><span className="text-primary">•</span><span><RichLine text={l.replace(/^\s*([-*+]|\d+[.)])\s+/, "")} /></span></li>
                ))}
              </ul>
            );
          }
          if (lines.every((l) => l.trim().startsWith("|"))) {
            const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l));
            return (
              <div key={key} className="overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={ri} className="border-b">
                        {r.trim().replace(/^\||\|$/g, "").split("|").map((c, ci) => (
                          <td key={ci} className={`px-2 py-1 align-top ${ri === 0 ? "font-semibold" : ""}`}><RichLine text={c.trim()} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          if (lines.every((l) => l.trim().startsWith(">"))) {
            return <p key={key} className="border-l-2 pl-3 text-muted-foreground"><RichLine text={lines.map((l) => l.replace(/^\s*>\s?/, "")).join(" ")} /></p>;
          }
          return <p key={key}><RichLine text={lines.map((l) => l.replace(/^#{1,6}\s+/, "")).join(" ")} /></p>;
        });
      })}
    </div>
  );
};

export interface ReadMoreSection { heading: string; text: string; source: string; licence: string }

/** Extra reading for a step, from open-licence repos, shown inside the app. */
export const ReadMoreCards = ({ sections }: { sections: ReadMoreSection[] }) => (
  <div className="space-y-3">
    {sections.map((s, i) => (
      <div key={i} className="rounded-lg border border-dashed bg-muted/30 p-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Read more</p>
        <p className="mt-1 font-semibold">{s.heading.replace(/\s*\{[^}]*\}\s*$/, "")}</p>
        <div className="mt-2"><MarkdownLite text={s.text} /></div>
        <p className="mt-3 text-[11px] text-muted-foreground">From {s.source} · {s.licence} licence</p>
      </div>
    ))}
  </div>
);
