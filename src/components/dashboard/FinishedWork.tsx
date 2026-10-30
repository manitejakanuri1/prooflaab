import { format } from "date-fns";
import type { FinishedWorkItem } from "@/recruiter/types";
import VoicePlayButton from "./recruiter/VoicePlayButton";

/**
 * Every finished task of one student, opened row by row: the code or written
 * answer, the voice words and the recording (migration 168). Admin and the
 * student's own college always get this; a company only when the student's one
 * switch is on. The server decides who receives the list and who may play.
 */
const FinishedWork = ({ work }: { work: FinishedWorkItem[] }) => {
  if (work.length === 0) return <p className="text-sm text-muted-foreground">Nothing finished yet.</p>;
  return (
    <div className="space-y-1.5" data-testid="finished-work">
      {work.map((w) => (
        <details key={w.task_id} className="rounded-lg border px-3 py-2 text-sm">
          <summary className="flex cursor-pointer items-center gap-3">
            <span className="min-w-0 truncate">{w.title ?? "Task"}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              {w.kind === "code" && w.total_count ? `${w.passed_count ?? 0}/${w.total_count} tests · ` : ""}
              {w.attempts > 1 ? `${w.attempts} tries · ` : ""}
              {w.voice?.score != null ? `voice ${w.voice.score} · ` : ""}
              {w.submitted_at ? format(new Date(w.submitted_at), "d MMM") : ""}
            </span>
          </summary>
          <div className="mt-2 space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {w.kind === "code" ? `Code${w.language ? ` · ${w.language}` : ""}` : "Written answer"}
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">{w.answer ?? "—"}</pre>
            {w.voice && (
              <div className="space-y-1.5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Voice explanation</p>
                {w.voice.has_audio && <VoicePlayButton voiceId={w.voice.id} />}
                <p className="text-xs">{w.voice.words || "No words were heard."}</p>
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
};

export default FinishedWork;
