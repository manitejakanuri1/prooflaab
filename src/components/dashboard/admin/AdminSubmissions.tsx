import { lotLine, pickVoice, plainCode, voiceWord } from "@/lib/lotText";
import { of10 } from "@/lib/lotMarks";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtIST } from "@/lib/ist";

interface Row {
  id: string;
  status: string;
  sandbox_score: number | null;
  passed_count: number | null;
  total_count: number | null;
  runner: string | null;
  flags: string[] | null;
  created_at: string;
  sandbox_config_id: string | null;
  tasks: { title: string; source: string | null; sponsor_company?: string | null } | null;
  student_profiles: { full_name: string } | null;
  voice?: boolean;
  task_id?: string;
  student_id?: string;
  /** Y1: the Lot's voice, for an answer/code row (an accepted recording wins, else the newest). */
  lotVoice?: { status: string; evaluation: { attempt_fail?: string } | null; communication_score: number | null } | null;
}

type V = { task_id: string; student_id: string; status: string; evaluation: { attempt_fail?: string } | null;
           communication_score: number | null; created_at: string; withdrawn_at: string | null };

// Y1/Y2 (12 Nov 2026): one status line, the same words as the student and college screens (lotLine).
const resultText = (r: Row) => {
  const mark10 = r.sandbox_score != null ? r.sandbox_score / 10 : null;
  if (r.voice) {
    const w = voiceWord(r.status, r.flags?.[0], r.sandbox_score);
    return `${w[0].toUpperCase()}${w.slice(1)}${r.status === "scored" && mark10 != null ? ` · ${of10(r.sandbox_score)}` : ""}`;
  }
  const v = r.lotVoice;
  return lotLine({ answer: r.status, mark10, voice: v?.status ?? null, reason: v?.evaluation?.attempt_fail, voiceScore: v?.communication_score,
                  company: r.tasks?.sponsor_company });
};

interface VoiceRow {
  id: string;
  status: string;
  communication_score: number | null;
  created_at: string;
  evaluation: { attempt_fail?: string } | null;
  tasks: { title: string; source: string | null } | null;
  student_profiles: { full_name: string } | null;
}

// S1 (the done rule, migration 320/351): an accepted voice is scored (score >= 50) and has no attempt_fail.
const isVoiceAccepted = (v: { status: string; communication_score: number | null; evaluation: { attempt_fail?: string } | null } | null | undefined): boolean =>
  !!v && v.status === "scored" && (v.communication_score == null || v.communication_score >= 50) && !v.evaluation?.attempt_fail;

// M7: voice recordings live in voice_explanations, not task_submissions, so they were never listed here.
async function voiceRows(status: string): Promise<Row[]> {
  let q = supabase.from("voice_explanations")
    .select("id, status, communication_score, created_at, evaluation, tasks(title, source), student_profiles(full_name)")
    .is("withdrawn_at", null).order("created_at", { ascending: false }).limit(200);
  if (status === "passed") q = q.eq("status", "scored").gte("communication_score", 50);
  if (status === "failed") q = q.eq("status", "failed");
  const { data, error } = await q;
  if (error) throw error;
  const list = ((data as unknown as VoiceRow[]) ?? []).filter((v) => {
    if (status === "passed") {
      return v.status === "scored" && (v.communication_score == null || v.communication_score >= 50) && !v.evaluation?.attempt_fail;
    }
    if (status === "failed") {
      return v.status === "failed" || (v.status === "scored" && ((v.communication_score != null && v.communication_score < 50) || !!v.evaluation?.attempt_fail));
    }
    return true;
  });
  return list.map((v) => ({
    id: v.id, status: v.status, sandbox_score: v.communication_score, passed_count: null, total_count: null,
    runner: null, flags: v.evaluation?.attempt_fail ? [v.evaluation.attempt_fail] : null, created_at: v.created_at,
    sandbox_config_id: null, tasks: v.tasks, student_profiles: v.student_profiles, voice: true,
  }));
}

/**
 * Admin > Work Queue > Submissions: every graded attempt on the platform, newest
 * first, from task_submissions (the one source of student work since the proof
 * system was retired). A "Looks copied" try keeps its mark (migration 229); the Flags column names the
 * student it matches (copied_answer_notes).
 */
const AdminSubmissions = () => {
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState<Row | null>(null);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin-submissions", status],
    queryFn: async (): Promise<Row[]> => {
      if (status === "voice") return voiceRows("all");
      let q = supabase.from("task_submissions")
        .select("id, task_id, student_id, status, sandbox_score, passed_count, total_count, runner, flags, created_at, sandbox_config_id, tasks(title, source, sponsor_company), student_profiles(full_name)")
        .order("created_at", { ascending: false }).limit(200);
      if (status !== "all") q = q.eq("status", status);
      const [{ data, error }, voices] = await Promise.all([q, voiceRows(status)]);
      if (error) throw error;
      let rows = (data as unknown as Row[]) ?? [];
      const ids = [...new Set(rows.map((r) => r.task_id).filter(Boolean))] as string[];
      const { data: vs } = ids.length
        ? await supabase.from("voice_explanations")
            .select("task_id, student_id, status, evaluation, communication_score, created_at, withdrawn_at").in("task_id", ids)
        : { data: [] };
      for (const r of rows) r.lotVoice = pickVoice(((vs ?? []) as unknown as V[]).filter((v) => v.task_id === r.task_id && v.student_id === r.student_id));
      // S1: Passed = passing answer AND accepted voice (the done rule, migration 320/351)
      if (status === "passed") {
        rows = rows.filter((r) => r.status === "passed" && isVoiceAccepted(r.lotVoice));
      }
      return [...rows, ...voices]
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200);
    },
  });

  const { data: copied = new Map<string, string>() } = useQuery({
    queryKey: ["copied-answer-notes", "admin"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("copied_answer_notes" as never, { _limit: 200 } as never);
      if (error) throw error;
      return new Map(((data ?? []) as { submission_id: string; other_name: string | null }[])
        .map((n) => [n.submission_id, n.other_name ?? "another student"]));
    },
  });
  const flagText = (r: Row) => (r.flags ?? [])
    .map((f) => f === "copied_answer" && copied.has(r.id) ? `Looks copied (like ${copied.get(r.id)})` : plainCode(f)).join(", ");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Submissions</CardTitle>
          {/* Retest H3: say what the rows are, so this list and the Overview count are not compared as one number. */}
          {!isLoading && !error && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="submissions-what">
              {/* S11: this list is the newest rows only; Overview "Answers sent" is all time and has no voice. */}
              Newest {data.length} rows, not all time{data.length >= 200 ? " (the list stops at 200)" : ""}: {data.filter((r) => !r.voice).length} answer/code tries
              and {data.filter((r) => r.voice).length} voice recordings, retries included. Overview "Answers sent" counts every answer/code try ever (no voice).
            </p>
          )}
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="passed">Passed</SelectItem>
            <SelectItem value="failed">Not passed</SelectItem>
            <SelectItem value="voice">Voice only</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
         error ? <p className="text-sm text-alert">{(error as Error).message}</p> :
         data.length === 0 ? <p className="text-sm text-muted-foreground">No submissions.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-3">When</th><th className="pb-2 pr-3">Student</th><th className="pb-2 pr-3">Task</th>
                  <th className="pb-2 pr-3">Kind</th><th className="pb-2 pr-3">Result</th><th className="pb-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => setOpen(r)}>
                    <td className="py-2 pr-3 font-mono text-xs">{fmtIST(r.created_at)}</td>
                    <td className="py-2 pr-3">{r.student_profiles?.full_name ?? "—"}</td>
                    <td className="py-2 pr-3">{r.tasks?.title ?? "—"}</td>
                    <td className="py-2 pr-3">{r.voice ? "voice" : r.sandbox_config_id ? `code (${r.passed_count ?? 0}/${r.total_count ?? 0})` : "written"}</td>
                    <td className="py-2 pr-3"><Badge variant={r.status === "passed" || (r.voice && r.status === "scored") ? "default" : "secondary"}>{resultText(r)}</Badge></td>
                    <td className="py-2 text-xs text-muted-foreground">{flagText(r) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-md">
          {open && (
            <>
              <DialogHeader><DialogTitle>{open.tasks?.title ?? "Submission"}</DialogTitle></DialogHeader>
              <div className="space-y-1 text-sm">
                <p><span className="font-medium">Student:</span> {open.student_profiles?.full_name ?? "—"}</p>
                <p><span className="font-medium">When:</span> {fmtIST(open.created_at)}</p>
                <p><span className="font-medium">Source:</span> {open.tasks?.source ?? "—"}</p>
                <p><span className="font-medium">Kind:</span> {open.voice ? "voice" : open.sandbox_config_id ? "code" : "written"}</p>
                {open.total_count != null && <p><span className="font-medium">Tests passed:</span> {open.passed_count ?? 0} of {open.total_count}</p>}
                <p><span className="font-medium">Result:</span> {resultText(open)}</p>
                {open.runner && <p><span className="font-medium">Runner:</span> {open.runner}</p>}
                <p><span className="font-medium">Flags:</span> {flagText(open) || "—"}</p>
                <p className="font-mono text-[10px] text-muted-foreground">id {open.id}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default AdminSubmissions;
