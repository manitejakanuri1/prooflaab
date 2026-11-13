import { fmtDay } from "@/lib/ist";
import { of10 } from "@/lib/lotMarks";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Code2, Mic, PenLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { tidyTitle } from "@/lib/utils";
import { passedLabel } from "@/lib/passedNote";
import { Link } from "react-router-dom";
import type { VoicePendingTask } from "@/hooks/useVoicePendingTasks";

interface Row {
  task_id: string;
  title: string;
  category: string | null;
  kind: "code" | "written";
  language: string | null;
  score: number | null;
  passed_count: number | null;
  total_count: number | null;
  passed_at: string;
  explanation_score: number | null;
  set_by: string | null;
}

export const useProvenWork = (studentId?: string | null) =>
  useQuery({
    queryKey: ["portfolio-work", studentId],
    enabled: Boolean(studentId),
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("portfolio_work" as never, { _student_id: studentId } as never);
      if (error) throw error;
      return (data as unknown as Row[]) ?? [];
    },
  });

/**
 * What a student has proven: the Lots they finished (passed + voice accepted, migration 320), with the checked score and the
 * score of their spoken explanation. Read from portfolio_work() (task_submissions +
 * voice_explanations) - the retired proof uploads are not shown. No code or answers
 * are shown here, only what was passed and when.
 *
 * N4 (13 Nov 2026): if Lots are passed but waiting for 60-second voice, tell the student so with a link to record it.
 */
export default function ProvenWork({
  studentId,
  rows,
  emptyText,
  pendingVoice,
}: {
  studentId?: string | null;
  rows?: Row[];
  emptyText: string;
  pendingVoice?: VoicePendingTask[];
}) {
  // `rows` is the signed-out portfolio, which arrives with its work already read.
  const { data: fetched = [], isLoading: fetching, error: fetchError } = useProvenWork(rows ? null : studentId);
  const data = rows ?? fetched;
  const isLoading = !rows && fetching;
  const error = rows ? null : fetchError;

  if (isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="py-8 text-center text-sm text-destructive">Could not load the work. Please try again.</p>;

  if (data.length === 0) {
    if (pendingVoice && pendingVoice.length > 0) {
      return (
        <div className="rounded-2xl border border-dashed p-10 text-center space-y-3">
          <Mic className="mx-auto h-10 w-10 text-primary" />
          <p className="text-sm font-medium text-foreground">
            {pendingVoice.length} {pendingVoice.length === 1 ? "Lot" : "Lots"} passed, waiting for your 60-second voice. Record it to add {pendingVoice.length === 1 ? "it" : "them"} here.
          </p>
          <div className="flex justify-center flex-wrap gap-2 pt-1">
            {pendingVoice.map((p) => (
              <Link
                key={p.id}
                to={`/student/tasks/assigned?open=${encodeURIComponent(p.id)}&voice=1`}
                className="inline-flex items-center text-xs font-medium text-primary hover:underline border rounded-md px-2.5 py-1 bg-primary/5"
              >
                Record voice for {tidyTitle(p.title)} →
              </Link>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-dashed p-10 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pendingVoice && pendingVoice.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary shrink-0" />
            <p className="text-sm font-medium">
              {pendingVoice.length} {pendingVoice.length === 1 ? "Lot" : "Lots"} passed, waiting for your 60-second voice. Record it to add {pendingVoice.length === 1 ? "it" : "them"} here.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingVoice.map((p) => (
              <Link
                key={p.id}
                to={`/student/tasks/assigned?open=${encodeURIComponent(p.id)}&voice=1`}
                className="text-xs font-medium text-primary hover:underline border rounded px-2 py-0.5 bg-background"
              >
                Record voice for {tidyTitle(p.title)} →
              </Link>
            ))}
          </div>
        </div>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {data.map((w) => (
          <li key={w.task_id} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium leading-snug">{tidyTitle(w.title)}</p>
              {/* Owner rule B: "Passed" only with a spoken explanation of 50+. S6 (migration 320): every row here is done
                  (voice accepted); the score comes only when 50+, so a missing one is a low voice score. */}
              <Badge className="shrink-0">{passedLabel(w.kind, w.explanation_score ?? 0)}{w.score != null ? ` · ${of10(w.score)}` : ""}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {w.kind === "code" ? <Code2 className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
                {w.kind === "code"
                  ? `${w.passed_count ?? 0} of ${w.total_count ?? 0} tests${w.language ? ` · ${w.language}` : ""}`
                  : "Written answer"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Mic className="h-3.5 w-3.5" />
                {w.explanation_score != null ? `Explained · ${of10(w.explanation_score)}` : "Explained"}
              </span>
              <span>{fmtDay(w.passed_at)}</span>
              {w.set_by && <span>Set by {w.set_by}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
