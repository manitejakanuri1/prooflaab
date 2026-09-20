import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildPracticeDoc } from "@/lib/practiceDoc";

interface PracticeBoxProps {
  files: Record<string, string>;
}

interface ConsoleLine { level: string; text: string }

/**
 * "Try it yourself": edit the lesson's code, press Run, see the page and its console output
 * right below. Runs inside ProofLab in a sandboxed frame (scripts only, no access to the
 * app's login or storage). Replaces the StackBlitz embed.
 */
const PracticeBox = ({ files }: PracticeBoxProps) => {
  const names = Object.keys(files);
  const [edited, setEdited] = useState(files);
  const [active, setActive] = useState(names[0]);
  const [doc, setDoc] = useState(() => buildPracticeDoc(files));
  const [runs, setRuns] = useState(0);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);

  // A new step brings new files: start again from them.
  useEffect(() => {
    setEdited(files); setActive(Object.keys(files)[0]);
    setDoc(buildPracticeDoc(files)); setLines([]); setRuns((n) => n + 1);
  }, [files]);

  // The frame reports console.log and errors; only take messages from our own frame.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.practice) return;
      // Warnings the Tailwind and Vue libraries print about themselves are noise to a student.
      if (/should not be used in production|running a development build of Vue|use the production build/i.test(String(e.data.text))) return;
      setLines((cur) => (cur.length >= 200 ? cur : [...cur, { level: String(e.data.level), text: String(e.data.text).slice(0, 500) }]));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const run = () => { setLines([]); setDoc(buildPracticeDoc(edited)); setRuns((n) => n + 1); };
  const reset = () => { setEdited(files); setLines([]); setDoc(buildPracticeDoc(files)); setRuns((n) => n + 1); };

  return (
    <div className="rounded-lg border overflow-hidden">
      {names.length > 1 && (
        <div className="flex gap-1 border-b bg-muted/40 px-2 pt-2">
          {names.map((n) => (
            <button key={n} type="button" onClick={() => setActive(n)}
              className={`rounded-t px-3 py-1 font-mono text-xs ${n === active ? "bg-background font-semibold" : "text-muted-foreground"}`}>
              {n}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={edited[active] ?? ""}
        onChange={(e) => setEdited((cur) => ({ ...cur, [active]: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          e.preventDefault();
          const t = e.currentTarget; const s = t.selectionStart;
          const v = t.value.slice(0, s) + "  " + t.value.slice(t.selectionEnd);
          setEdited((cur) => ({ ...cur, [active]: v }));
          requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
        }}
        spellCheck={false}
        aria-label={`Code: ${active}`}
        className="block h-48 w-full resize-y bg-[#1e1e1e] p-3 font-mono text-xs leading-relaxed text-[#d4d4d4] outline-none"
      />
      <div className="flex items-center gap-2 border-t bg-muted/40 px-3 py-2">
        <Button type="button" size="sm" onClick={run}><Play className="mr-1.5 h-3.5 w-3.5" /> Run</Button>
        <Button type="button" size="sm" variant="outline" onClick={reset}><RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset</Button>
        <span className="ml-auto text-[11px] text-muted-foreground">Runs here. Nothing leaves ProofLab.</span>
      </div>
      <iframe
        key={runs}
        ref={frame}
        title="Result"
        sandbox="allow-scripts"
        srcDoc={doc}
        className="block h-64 w-full border-t bg-white"
      />
      {lines.length > 0 && (
        <pre className="max-h-40 overflow-auto border-t bg-[#1e1e1e] p-3 font-mono text-xs leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-300" : "text-[#d4d4d4]"}>{l.text}</div>
          ))}
        </pre>
      )}
    </div>
  );
};

export default PracticeBox;
