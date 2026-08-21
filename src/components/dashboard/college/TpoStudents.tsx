import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Bell } from "lucide-react";
import TpoImportStudents from "./TpoImportStudents";
import TpoStudentProfile from "./TpoStudentProfile";
import { ChevronRight } from "lucide-react";

interface Row {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  branch: string | null;
  batch: string | null;
  email: string | null;
  squad_id: string | null;
  squad_name: string | null;
  is_reserve: boolean;
  days_quiet: number;
  trust_score: number | null;
  total_xp: number | null;
  onboarding_status: string;
  lots_done: number;
  attention: string;
}

interface Props {
  /** Set by Home when a "needs attention" line is tapped. */
  initialFilter?: string;
  /** Jump to a squad, on its Members tab. */
  onOpenSquad?: (squadId: string) => void;
}

const recency = (d: number) => (d >= 999 ? "never" : `${d}d`);

/**
 * Students — one workspace for finding, filtering and acting.
 *
 * "Needs attention" is a filter here, never a separate page: an at-risk student
 * is still just a student, and giving them their own screen means an officer has
 * to remember which of two lists someone is on.
 *
 * The columns that matter are the ones the old screen did not have. Roll number
 * is how a college names a student. Recency is what tells you who has stopped
 * showing up — a trust score says how good someone is, not whether they are
 * still here.
 */
const TpoStudents = ({ initialFilter, onOpenSquad }: Props) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("all");
  const [batch, setBatch] = useState("all");
  const [squad, setSquad] = useState("all");
  const [status, setStatus] = useState(initialFilter && initialFilter !== "all" ? initialFilter : "all");
  const [sending, setSending] = useState<string | null>(null);
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [openStudent, setOpenStudent] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data, error: err }, cid] = await Promise.all([
      supabase.rpc("tpo_students" as never),
      supabase.rpc("my_college_id" as never),
    ]);
    if (err) { setError(err.message); return; }
    setRows((data ?? []) as unknown as Row[]);
    setCollegeId((cid.data as unknown as string | null) ?? null);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (initialFilter) setStatus(initialFilter === "all" ? "attention" : initialFilter);
  }, [initialFilter]);

  const branches = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.branch).filter(Boolean))] as string[], [rows]);
  const batches = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.batch).filter(Boolean))] as string[], [rows]);
  const squads = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.squad_name).filter(Boolean))] as string[], [rows]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && ![r.full_name, r.roll_number, r.email]
        .some((v) => v?.toLowerCase().includes(needle))) return false;
      if (branch !== "all" && r.branch !== branch) return false;
      if (batch !== "all" && r.batch !== batch) return false;
      if (squad === "reserve" ? !r.is_reserve : squad !== "all" && r.squad_name !== squad) return false;
      if (status === "attention" && r.attention === "ok") return false;
      if (status === "inactive" && r.days_quiet < 7) return false;
      if (status === "onboarding" && r.onboarding_status === "completed") return false;
      if (status === "active_today" && r.days_quiet > 0) return false;
      return true;
    });
  }, [rows, q, branch, batch, squad, status]);

  const remind = async (r: Row) => {
    setSending(r.student_id);
    const reason = r.days_quiet >= 7
      ? `No activity for ${r.days_quiet} days`
      : `Onboarding not finished (${r.onboarding_status})`;
    const { error: err } = await supabase.rpc("tpo_send_reminder" as never, {
      _student_id: r.student_id, _reason: reason,
    } as never);
    setSending(null);
    if (err) {
      toast({ title: "Reminder not sent", description: err.message, variant: "destructive" });
      return;
    }
    toast({ title: `Reminder sent to ${r.full_name}`, description: reason });
  };

  if (error) {
    return <Card><CardContent className="pt-6">
      <p className="text-sm text-muted-foreground">{error}</p></CardContent></Card>;
  }
  if (!rows) return <Skeleton className="h-96 w-full rounded-xl" />;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Students</h1>
        <p className="text-sm text-muted-foreground">
          Import, search, filter and act on student records.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, roll number or email"
          className="w-full sm:w-72"
        />
        <Select value={branch} onValueChange={setBranch}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Branch" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={batch} onValueChange={setBatch}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Year" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {batches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={squad} onValueChange={setSquad}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Squad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All squads</SelectItem>
            <SelectItem value="reserve">Reserve</SelectItem>
            {squads.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="attention">Needs attention</SelectItem>
            <SelectItem value="inactive">Quiet 7+ days</SelectItem>
            <SelectItem value="onboarding">Onboarding unfinished</SelectItem>
            <SelectItem value="active_today">Active today</SelectItem>
          </SelectContent>
        </Select>

        <TpoImportStudents collegeId={collegeId} onImported={() => void load()} />
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-baseline mb-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {shown.length} shown
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {rows.length} total
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-3">Student</th>
                  <th className="pb-2 pr-3">Roll no.</th>
                  <th className="pb-2 pr-3">Branch</th>
                  <th className="pb-2 pr-3">Squad</th>
                  <th className="pb-2 pr-3">Recency</th>
                  <th className="pb-2 pr-3">Lots</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.student_id}
                    className="border-t cursor-pointer hover:bg-muted/40"
                    onClick={() => setOpenStudent(r.student_id)}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{r.full_name}</div>
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-xs">
                      {r.roll_number ?? "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{r.branch ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      {r.is_reserve
                        ? <Badge variant="outline" className="font-normal">Reserve</Badge>
                        : r.squad_name}
                    </td>
                    <td className={`py-2.5 pr-3 font-mono tabular-nums ${
                      r.days_quiet >= 7 ? "text-destructive" : "text-muted-foreground"}`}>
                      {recency(r.days_quiet)}
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">{r.lots_done}</td>
                    <td className="py-2.5 pr-3">
                      {r.attention === "ok" ? (
                        <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">Active</Badge>
                      ) : r.attention === "high" ? (
                        <Badge variant="destructive">Needs attention</Badge>
                      ) : (
                        <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">Needs attention</Badge>
                      )}
                      {r.onboarding_status !== "completed" && (
                        <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                          {r.onboarding_status.replace("_", " ")}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 whitespace-nowrap">
                      {r.attention !== "ok" && (
                        <Button
                          size="sm" variant="outline"
                          disabled={sending === r.student_id}
                          // The row opens the profile; this button must not do
                          // both at once.
                          onClick={(e) => { e.stopPropagation(); void remind(r); }}
                        >
                          <Bell className="h-3 w-3 mr-1" />
                          {sending === r.student_id ? "Sending…" : "Remind"}
                        </Button>
                      )}
                      <ChevronRight className="h-4 w-4 inline-block ml-2 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    No students match these filters.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <TpoStudentProfile
        studentId={openStudent}
        onClose={() => setOpenStudent(null)}
        onOpenSquad={onOpenSquad}
        onChanged={() => void load()}
      />
    </div>
  );
};

export default TpoStudents;
