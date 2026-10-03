import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, Loader2, NotebookPen } from "lucide-react";
import { useBuildLog, voiceInProgress, type BuildLogEntry } from "@/hooks/useBuildLog";
import StudentVoiceExplanationsCard from "./StudentVoiceExplanationsCard";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  passed: { label: "Passed", variant: "default" },
  failed: { label: "Not passed yet", variant: "secondary" },
  needs_review: { label: "Being checked", variant: "outline" },
};

const VoiceLine = ({ e }: { e: BuildLogEntry }) => {
  const v = e.voice;
  if (!v) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Mic className="h-4 w-4" />No spoken explanation yet.</p>;
  if (voiceInProgress(v)) {
    const step = v.transcription_status === "completed" ? "Evaluating" : v.transcription_status === "processing" ? "Transcribing" : "Queued";
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Spoken explanation: {step}…</p>;
  }
  if (v.status === "failed") {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Mic className="h-4 w-4" />Spoken explanation could not be scored{v.communication_notes ? `: ${v.communication_notes}` : "."}</p>;
  }
  return (
    <div className="text-sm">
      <p className="flex items-center gap-2"><Mic className="h-4 w-4" /><span className="font-medium">Spoken explanation: {v.communication_score}/100</span></p>
      {v.communication_notes && <p className="ml-6 text-muted-foreground">{v.communication_notes}</p>}
      {v.transcript && (
        <details className="ml-6 mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">What you said</summary>
          <p className="mt-1 whitespace-pre-wrap text-xs">{v.transcript}</p></details>
      )}
    </div>
  );
};

/** Build-log > Entries: one card per piece of work, newest first (task_submissions + voice). */
const BuildLogEntries = () => {
  const { data: entries = [], isLoading, error } = useBuildLog();

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}</div>;
  if (error) return <p className="text-sm text-destructive">Could not load your Build-log. Please refresh.</p>;

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <NotebookPen className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Nothing here yet</p>
          <p className="text-sm text-muted-foreground">Submit today's Lot from your Daily Card - every piece of work you submit is recorded here.</p>
        </CardContent></Card>
      ) : entries.map((e) => {
        const st = STATUS[e.status] ?? { label: e.status, variant: "outline" as const };
        return (
          <Card key={e.task_id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{e.title}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {e.lot_date ? `Lot of ${format(new Date(e.lot_date), "dd MMM yyyy")}` : "Task"}
                    {e.source_jd ? ` · ${e.source_jd}` : ""}
                  </p>
                </div>
                <Badge variant={st.variant}>{st.label}{e.score != null ? ` · ${e.score}/100` : ""}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {e.kind === "code" && e.total_count != null && (
                <p className="text-sm">Tests passed: <span className="font-medium">{e.passed_count ?? 0} of {e.total_count}</span>{e.language ? ` · ${e.language}` : ""}</p>
              )}
              {e.kind === "written" && e.feedback && e.feedback.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {e.feedback.map((f) => (
                    <li key={f.criterion_id} className="flex gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{f.points} pts</span>
                      <span>{f.criterion_id.replace(/_/g, " ")}{f.evidence ? ` - "${f.evidence}"` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
              {e.work && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Your {e.kind === "code" ? "code" : "answer"}</summary>
                  <pre className={`mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs ${e.kind === "code" ? "font-mono" : "font-sans"}`}>{e.work}</pre>
                </details>
              )}
              <VoiceLine e={e} />
              <p className="text-xs text-muted-foreground">
                Submitted {format(new Date(e.submitted_at), "dd MMM yyyy, HH:mm")}{e.attempts > 1 ? ` · ${e.attempts} attempts` : ""}
              </p>
            </CardContent>
          </Card>
        );
      })}
      {/* Recordings not yet tied to a submission (until Wave 6 makes voice part of Submit). */}
      <StudentVoiceExplanationsCard />
    </div>
  );
};

export default BuildLogEntries;
