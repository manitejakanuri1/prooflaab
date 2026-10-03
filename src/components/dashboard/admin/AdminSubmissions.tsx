import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  tasks: { title: string; source: string | null } | null;
  student_profiles: { full_name: string } | null;
}

/**
 * Admin > Work Queue > Submissions: every graded attempt on the platform, newest
 * first, from task_submissions (the one source of student work since the proof
 * system was retired). Flagged ones are also listed in "Flagged submissions",
 * where they can be re-decided.
 */
const AdminSubmissions = () => {
  const [status, setStatus] = useState("all");
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin-submissions", status],
    queryFn: async (): Promise<Row[]> => {
      let q = supabase.from("task_submissions")
        .select("id, status, sandbox_score, passed_count, total_count, runner, flags, created_at, sandbox_config_id, tasks(title, source), student_profiles(full_name)")
        .order("created_at", { ascending: false }).limit(200);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as Row[]) ?? [];
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Submissions</CardTitle>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="passed">Passed</SelectItem>
            <SelectItem value="failed">Not passed</SelectItem>
            <SelectItem value="needs_review">Needs review</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
         error ? <p className="text-sm text-destructive">{(error as Error).message}</p> :
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
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-3 font-mono text-xs">{format(new Date(r.created_at), "dd MMM HH:mm")}</td>
                    <td className="py-2 pr-3">{r.student_profiles?.full_name ?? "—"}</td>
                    <td className="py-2 pr-3">{r.tasks?.title ?? "—"}</td>
                    <td className="py-2 pr-3">{r.sandbox_config_id ? `code (${r.passed_count ?? 0}/${r.total_count ?? 0})` : "written"}</td>
                    <td className="py-2 pr-3"><Badge variant={r.status === "passed" ? "default" : "secondary"}>{r.status}{r.sandbox_score != null ? ` · ${r.sandbox_score}` : ""}</Badge></td>
                    <td className="py-2 text-xs text-muted-foreground">{(r.flags ?? []).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AdminSubmissions;
