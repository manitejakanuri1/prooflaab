import { format } from "date-fns";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, NotebookPen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBuildLog, voiceInProgress, type BuildLogEntry } from "@/hooks/useBuildLog";
import { passedLabel, passedNote } from "@/lib/passedNote";
import { fmtMark, loadLotState, of10, talkCheck, SCORE_HELP } from "@/lib/lotMarks";
import InfoTip from "@/components/common/InfoTip";
import { lotStatusText, part10, voiceOwedText, AUTO_TRANSCRIPT_NOTE } from "@/lib/lotText";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  passed: { label: "Passed", variant: "default" },
  needs_review: { label: "Being checked", variant: "outline" },
};

interface Label { task_id: string; criterion_id: string; name: string; max_points: number }

/** One number with its label: the unit every result on this page is built from. */
const Score = ({ label, value, sub, help }: { label: string; value: string; sub?: string; help?: string }) => (
  <div className="rounded-lg border px-3 py-2">
    <p className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {label}{help && <InfoTip text={help} />}
    </p>
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
        <p className="text-sm text-muted-foreground">Submit today's Lot from ProofLab - every piece of work you submit is recorded here.</p>
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
  const v = e.voice;
  const busy = voiceInProgress(v);
  const scored = v?.status === "scored";
  // F1 (round 3): a Daily Lot whose spoken part is closed (two bad recordings) says so, as the Lot page
  // does, instead of the stored "record again" note of the last recording. The server decides (my_lot_state).
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!e.lot_date || v?.status !== "failed") return;
    loadLotState(e.task_id).then((s) => setClosed(Boolean(s?.voice_closed)), () => {});
  }, [e.task_id, e.lot_date, v?.status]);
  // Owner 1 Nov 2026: green "Passed" needs the voice at 50+ too (passedLabel).
  const passLabel = e.status === "passed" ? passedLabel(e.kind, scored ? v!.communication_score : null) : null;
  const rejected = v?.status === "failed" && !closed;
  const st = closed && e.status === "passed"
    ? { label: `${e.kind === "written" ? "Answer" : "Code"} passed · spoken part closed`, variant: "outline" as const }
    : rejected && e.status === "passed"
    // Retest F4: the same words as "Code passed - record your 60s explanation to finish", for a rejected voice.
    ? { label: `${e.kind === "written" ? "Answer" : "Code"} passed - voice not accepted - record again${e.lot_date === format(new Date(), "yyyy-MM-dd") ? " (due today)" : ""}`, variant: "outline" as const }
    // Item 21: work handed in, voice never recorded - the same words as the Daily Card.
    : !v && e.lot_date && e.task_status === "pending_voice"
    ? { label: voiceOwedText({ coding: e.kind === "code", passed: e.status === "passed", mark10: e.score != null ? e.score / 10 : null,
                               dueToday: e.lot_date === format(new Date(), "yyyy-MM-dd") }), variant: "outline" as const }
    : passLabel && passLabel !== "Passed" ? { label: passLabel, variant: "outline" as const }
    // QA round 2 item 10: the same words as the Daily Card and the Lot screen.
    : e.status === "failed" ? { label: lotStatusText({ passed: false, submitted: !!e.lot_date && ["pending_voice", "completed"].includes(e.task_status ?? ""),
                                                       mark10: e.score != null ? e.score / 10 : null }), variant: "secondary" as const }
    : STATUS[e.status] ?? { label: e.status, variant: "outline" as const };
  const match = v?.evaluation?.content_match;
  const gate = v?.evaluation?.transcription?.gate;
  const breakdown = (e.kind === "written" ? e.feedback ?? [] : []).map((f) => {
    const l = labelOf(e.task_id, f.criterion_id);
    return { id: f.criterion_id, name: l?.name ?? f.criterion_id.replace(/_/g, " "), points: f.points, max: l?.max_points, evidence: f.evidence, improve: f.to_improve };
  });
  // "Improve" names the criterion that lost the most points - a fact from the stored numbers, not new text.
  const weakest = breakdown.filter((b) => b.max != null && b.points < (b.max as number))
    .sort((a, b) => ((b.max as number) - b.points) - ((a.max as number) - a.points))[0];
  const hasDetail = Boolean(v?.communication_notes || v?.transcript || breakdown.some((b) => b.evidence || b.improve) || e.work);

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
          <Score label={e.kind === "written" ? "Answer" : "Code"}
                 value={e.counted != null ? `${fmtMark(e.counted)}/10` : of10(e.score)}
                 help={e.kind === "written" ? SCORE_HELP.answer() : SCORE_HELP.code()}
                 sub={e.kind === "code" && e.total_count != null
                   ? `Tests passed ${e.passed_count ?? 0} of ${e.total_count}${e.language ? ` · ${e.language}` : ""}${
                       e.counted === 0 && (e.passed_count ?? 0) > 0 ? " · from week 2 every test must pass" : ""}`
                   : e.kind === "written" ? "Written answer" : undefined} />
          <Score label="Voice" help={SCORE_HELP.voice}
                 value={scored ? of10(v!.communication_score) : "–"}
                 sub={!v ? "Not recorded yet" : busy ? undefined : scored ? undefined : closed ? "Closed" : rejected ? "Not accepted" : "Not scored"} />
          {scored && match != null && <Score label="Talk check" value={talkCheck(match)} help={SCORE_HELP.talk} />}
        </div>
        {e.status === "passed" && scored && passedNote(v!.communication_score, match) && (
          <p className="text-sm rounded-md border border-compete/30 bg-compete/5 p-3" data-testid="passed-note">
            {passedNote(v!.communication_score, match)}
          </p>
        )}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Spoken explanation: {v!.transcription_status === "completed" ? "Evaluating" : v!.transcription_status === "processing" ? "Transcribing" : "Queued"}…
          </p>
        )}
        {v && !busy && !scored && (closed || v.communication_notes) && (
          <p className="text-sm text-compete">
            {closed ? "The spoken part of this Lot is closed. Your coding mark is saved." : v.communication_notes}
          </p>
        )}
        {scored && gate && (
          <p className="text-xs text-muted-foreground">Language: {gate === "english" ? "English" : "accepted"}</p>
        )}

        {breakdown.length > 0 && (
          <div className="space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Breakdown</p>
            {breakdown.map((b) => <Row key={b.id} name={b.name} value={part10(b.points, b.max)} />)}
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
              {breakdown.filter((b) => b.evidence || b.improve).map((b) => (
                <div key={b.id} className="text-muted-foreground">
                  <p><span className="text-foreground">{b.name}:</span> {b.evidence ? `"${b.evidence}"` : "nothing quoted"}</p>
                  {/* QA round 2 item 28: one plain "to improve" line per part (new answers only). */}
                  {b.improve && <p data-testid="to-improve">To improve: {b.improve}</p>}
                </div>
              ))}
              {v?.transcript && (
                <div><p className="text-xs text-muted-foreground">What you said</p>
                  <p className="whitespace-pre-wrap text-xs">{v.transcript}</p>
                  <p className="text-[11px] italic text-muted-foreground" data-testid="auto-transcript-note">{AUTO_TRANSCRIPT_NOTE}</p></div>
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
