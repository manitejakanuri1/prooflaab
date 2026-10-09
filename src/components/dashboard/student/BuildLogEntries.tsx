import { format } from "date-fns";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, NotebookPen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBuildLog, voiceInProgress, type BuildLogEntry } from "@/hooks/useBuildLog";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  passed: { label: "Passed", variant: "default" },
  failed: { label: "Not passed yet", variant: "secondary" },
  needs_review: { label: "Being checked", variant: "outline" },
};

interface Label { task_id: string; criterion_id: string; name: string; max_points: number }

/** One number with its label: the unit every result on this page is built from. */
const Score = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-lg border px-3 py-2">
    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
    <p className="text-xl font-semibold tabular-nums leading-tight">{value}</p>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
  </div>
);

const Row = ({ name, value }: { name: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-4 text-sm">
    <span className="truncate">{name}</span>
    <span className="font-mono tabular-nums text-muted-foreground">{value}</span>
  </div>
);

/**
 * Build-log > Recent work: one compact card per piece of work, newest first.
 *
 * Every number shown is a stored field, nothing is derived into a new score:
 *   task result   task_submissions.sandbox_score, passed_count / total_count
 *   breakdown     task_submissions.rubric_scores (points) + my_rubric_labels() (name, maximum)
 *   explanation   voice_explanations.communication_score
 *   matches work  voice_explanations.evaluation.content_match
 *   language      voice_explanations.evaluation.transcription.gate
 * There is no combined "final score" in the backend, so none is shown. Hidden tests,
 * expected answers and the reference answer are never sent to this page.
 * The AI's sentences and the transcript sit behind "View detailed feedback".
 */
const BuildLogEntries = () => {
  const [searchParams] = useSearchParams();
  const targetTaskId = searchParams.get("task");
  const { data: entries = [], isLoading, error } = useBuildLog();
  const { data: labels = [] } = useQuery({
    queryKey: ["my-rubric-labels"],
    queryFn: async (): Promise<Label[]> => {
      const { data, error } = await supabase.rpc("my_rubric_labels" as never);
      if (error) throw error;
      return (data as unknown as Label[]) ?? [];
    },
  });
  const labelOf = (taskId: string, criterionId: string) =>
    labels.find((l) => l.task_id === taskId && l.criterion_id === criterionId);

  useEffect(() => {
    if (!targetTaskId || !entries.some(e => e.task_id === targetTaskId)) return;

    const frame = window.requestAnimationFrame(() => {
      const card = document.getElementById(`build-log-${targetTaskId}`);
      if (!card) return;

      const details = card.querySelector("details");
      if (details) details.open = true;

      card.scrollIntoView({ block: "center" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [targetTaskId, entries]);

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}</div>;
  if (error) return <p className="text-sm text-destructive">Could not load your Build-log. Please refresh.</p>;
  if (entries.length === 0) {
    return (
      <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <NotebookPen className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">Nothing here yet</p>
        <p className="text-sm text-muted-foreground">Submit today's Lot from the Floor - every piece of work you submit is recorded here.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map((e) => <Entry key={e.task_id} e={e} labelOf={labelOf} />)}
    </div>
  );
};

const Entry = ({ e, labelOf }: { e: BuildLogEntry; labelOf: (t: string, c: string) => Label | undefined }) => {
  const st = STATUS[e.status] ?? { label: e.status, variant: "outline" as const };
  const v = e.voice;
  const busy = voiceInProgress(v);
  const scored = v?.status === "scored";
  const match = v?.evaluation?.content_match;
  const gate = v?.evaluation?.transcription?.gate;
  const breakdown = (e.kind === "written" ? e.feedback ?? [] : []).map((f) => {
    const l = labelOf(e.task_id, f.criterion_id);
    return { id: f.criterion_id, name: l?.name ?? f.criterion_id.replace(/_/g, " "), points: f.points, max: l?.max_points, evidence: f.evidence };
  });
  // "Improve" names the criterion that lost the most points - a fact from the stored numbers, not new text.
  const weakest = breakdown.filter((b) => b.max != null && b.points < (b.max as number))
    .sort((a, b) => ((b.max as number) - b.points) - ((a.max as number) - a.points))[0];
  const hasDetail = Boolean(v?.communication_notes || v?.transcript || breakdown.some((b) => b.evidence) || e.work);

  return (
    <Card id={`build-log-${e.task_id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{e.title}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {e.lot_date ? `Lot of ${format(new Date(e.lot_date), "dd MMM yyyy")}` : "Task"}
              {` · submitted ${format(new Date(e.submitted_at), "dd MMM, HH:mm")}`}
              {e.attempts > 1 ? ` · ${e.attempts} attempts` : ""}
            </p>
          </div>
          <Badge variant={st.variant} className="shrink-0">{st.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Score label="Task result" value={e.score != null ? `${e.score}/100` : "—"}
                 sub={e.kind === "code" && e.total_count != null
                   ? `Tests passed ${e.passed_count ?? 0} of ${e.total_count}${e.language ? ` · ${e.language}` : ""}`
                   : e.kind === "written" ? "Written answer" : undefined} />
          <Score label="Voice explanation"
                 value={scored ? `${v!.communication_score}/100` : "—"}
                 sub={!v ? "Not recorded yet" : busy ? undefined : scored ? undefined : "Not scored"} />
          {scored && match != null && <Score label="Matches your work" value={`${match}/100`} />}
        </div>

        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Spoken explanation: {v!.transcription_status === "completed" ? "Evaluating" : v!.transcription_status === "processing" ? "Transcribing" : "Queued"}…
          </p>
        )}
        {v && !busy && !scored && v.communication_notes && (
          <p className="text-sm text-amber-700 dark:text-amber-400">{v.communication_notes}</p>
        )}
        {scored && gate && (
          <p className="text-xs text-muted-foreground">Language: {gate === "english" ? "English" : "accepted"}</p>
        )}

        {breakdown.length > 0 && (
          <div className="space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Breakdown</p>
            {breakdown.map((b) => <Row key={b.id} name={b.name} value={b.max != null ? `${b.points}/${b.max}` : `${b.points} pts`} />)}
          </div>
        )}
        {weakest && (
          <p className="text-sm"><span className="font-medium">Improve:</span> {weakest.name} ({weakest.points}/{weakest.max})</p>
        )}

        {hasDetail && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">View detailed feedback</summary>
            <div className="mt-2 space-y-3 text-sm">
              {v?.communication_notes && scored && <p>{v.communication_notes}</p>}
              {breakdown.filter((b) => b.evidence).map((b) => (
                <p key={b.id} className="text-muted-foreground"><span className="text-foreground">{b.name}:</span> "{b.evidence}"</p>
              ))}
              {v?.transcript && (
                <div><p className="text-xs text-muted-foreground">What you said</p>
                  <p className="whitespace-pre-wrap text-xs">{v.transcript}</p></div>
              )}
              {e.work && (
                <div><p className="text-xs text-muted-foreground">Your {e.kind === "code" ? "code" : "answer"}</p>
                  <pre className={`max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs ${e.kind === "code" ? "font-mono" : "font-sans"}`}>{e.work}</pre></div>
              )}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
};

export default BuildLogEntries;
