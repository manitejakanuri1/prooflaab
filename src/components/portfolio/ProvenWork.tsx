import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Code2, Mic, PenLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { tidyTitle } from "@/lib/utils";

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
 * What a student has proven: the Lots they passed, with the checked score and the
 * score of their spoken explanation. Read from portfolio_work() (task_submissions +
 * voice_explanations) - the retired proof uploads are not shown. No code or answers
 * are shown here, only what was passed and when.
 */
export default function ProvenWork({ studentId, rows, emptyText }: { studentId?: string | null; rows?: Row[]; emptyText: string }) {
  // `rows` is the signed-out portfolio, which arrives with its work already read.
  const { data: fetched = [], isLoading: fetching, error: fetchError } = useProvenWork(rows ? null : studentId);
  const data = rows ?? fetched;
  const isLoading = !rows && fetching;
  const error = rows ? null : fetchError;

  if (isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="py-8 text-center text-sm text-destructive">Could not load the work. Please try again.</p>;
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-10 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {data.map((w) => (
        <li key={w.task_id} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium leading-snug">{tidyTitle(w.title)}</p>
            <Badge className="shrink-0">Passed{w.score != null ? ` · ${w.score}/100` : ""}</Badge>
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
              {w.explanation_score != null ? `Explained · ${w.explanation_score}/100` : "Not explained yet"}
            </span>
            <span>{format(new Date(w.passed_at), "d MMM yyyy")}</span>
            {w.set_by && <span>Set by {w.set_by}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
