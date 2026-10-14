import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { confirmRemoval, removeStudents } from "@/lib/removeStudents";
import { Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Bell, ClipboardList, FlagTriangleRight } from "lucide-react";
import TpoImportStudents from "./TpoImportStudents";
import TpoStudentProfile from "./TpoStudentProfile";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AssignTasksScreen from "@/components/dashboard/assignTasks/AssignTasksScreen";
// Reused as-is: needs_review_submissions()/review_task_submission() already
// scope to "admin OR this student's own approved college" (stage70), so the
// same screen is correct here without a college-specific fork.
import ReviewedSubmissions from "@/components/dashboard/admin/ReviewedSubmissions";
import { usePendingReviewCount } from "@/hooks/usePendingReviewCount";

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
  total_xp: number | null;
  onboarding_status: string;
  lots_done: number;
  attention: string;
  gap_skills: string[] | null;
  total_count: number;
}

const PAGE = 50;

interface Props {
  /** What the click that brought us here asked for. Undefined means everyone. */
  filter?: string;
  skill?: string;
  /**
   * Bumped on every navigation, including one that repeats the last. Without
   * it, tapping the same card twice sends identical props and nothing happens —
   * so a filter cleared by hand could not be re-applied by the card that set it.
   */
  intentKey?: number;
  /** Jump to a squad, on its Members tab. */
  onOpenSquad?: (squadId: string) => void;
}

const recency = (d: number) => (d >= 999 ? "never" : `${d}d`);

interface FilterOptions {
  branches?: string[]; batches?: string[]; squads?: string[]; skills?: string[];
}

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
const TpoStudents = ({ filter, skill: skillIntent, intentKey, onOpenSquad }: Props) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("all");
  const [batch, setBatch] = useState("all");
  const [squad, setSquad] = useState("all");
  const [status, setStatus] = useState("all");
  const [sending, setSending] = useState<string | null>(null);
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<FilterOptions>({});
  const [openStudent, setOpenStudent] = useState<string | null>(null);
  const [skill, setSkill] = useState<string>("all");
  const [assignOpen, setAssignOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const pendingReviews = usePendingReviewCount();

  /**
   * One page, filtered by the database.
   *
   * This used to fetch every student and filter them in the page. At six
   * students that is invisible; at ten thousand it is several megabytes on
   * every visit and ten thousand objects re-filtered on every keystroke.
   */
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error: err }, cid, opts] = await Promise.all([
      supabase.rpc("tpo_students" as never, {
        _search: q || null,
        _branch: branch, _batch: batch, _squad: squad,
        _status: status, _skill: skill,
        _limit: PAGE, _offset: page * PAGE,
      } as never),
      supabase.rpc("my_college_id" as never),
      supabase.rpc("tpo_student_filters" as never),
    ]);
    setLoading(false);
    if (err) { setError(err.message); return; }
    const list = (data ?? []) as unknown as Row[];
    setRows(list);
    setTotal(list[0]?.total_count ?? 0);
    setCollegeId((cid.data as unknown as string | null) ?? null);
    setOptions((opts.data ?? {}) as unknown as FilterOptions);
  }, [q, branch, batch, squad, status, skill, page]);

  // A query per keystroke would be one per letter typed. A short pause is
  // enough to tell "still typing" from "finished".
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useAutoRefresh(load);

  // Removing: one student from their row, or several ticked at once. Removes
  // their data and their login together; a partial record is kept first (no restore tool).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const togglePick = (id: string) => setPicked((cur) => {
    const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const remove = async (ids: string[], label: string) => {
    if (!ids.length) return;
    if (!confirmRemoval(label)) return;
    setRemoving(true);
    try {
      const r = await removeStudents(ids);
      toast({ title: `Removed ${r.removed} student${r.removed === 1 ? "" : "s"}`,
              description: r.loginFailures ? `${r.loginFailures} login(s) could not be deleted - the nightly sync will retry.` : undefined });
      setPicked(new Set());
      // Removing students can leave squads empty. Ask what to do with them:
      // OK deletes them; Cancel keeps them, and the next import fills them
      // again (form_squads seats new students in existing squads first).
      const { data: empty } = await supabase.rpc("tpo_empty_squads" as never);
      const n = Number(empty ?? 0);
      const s = n === 1 ? "" : "s";
      if (n > 0 && window.confirm(`${n} squad${s} ${n === 1 ? "is" : "are"} now empty. Remove ${n === 1 ? "it" : "them"} too?\n\nOK = remove the empty squad${s}.\nCancel = keep ${n === 1 ? "it" : "them"}; students you import next are placed in ${n === 1 ? "it" : "them"} first.`)) {
        const { error: sqErr } = await supabase.rpc("tpo_delete_empty_squads" as never);
        toast(sqErr
          ? { title: "Squads not removed", description: sqErr.message, variant: "destructive" }
          : { title: `Removed ${n} empty squad${s}` });
      }
      await load();
    } catch (e) {
      toast({ title: "Not removed", description: (e as Error).message, variant: "destructive" });
    }
    setRemoving(false);
  };

  // Any filter change starts again at the first page — page 4 of a filter that
  // now matches twelve students is an empty screen.
  useEffect(() => { setPage(0); }, [q, branch, batch, squad, status, skill]);
  // One place decides what the filters are, so the two can never be left set
  // from different clicks. Arriving from a skill gap means only that skill
  // matters — an attention filter would hide the students who are weak at it
  // but otherwise perfectly active.
  useEffect(() => {
    setStatus(filter ? (filter === "all" ? "attention" : filter) : "all");
    setSkill(skillIntent ?? "all");
    setQ("");
    setBranch("all");
    setBatch("all");
    setSquad("all");
  }, [intentKey, filter, skillIntent]);

  // Every value in the college, not just the ones on this page — otherwise
  // choosing MECH would be impossible while page one happens to be all CSE.
  const branches = options.branches ?? [];
  const batches  = options.batches  ?? [];
  const squads   = options.squads   ?? [];
  const skills   = options.skills   ?? [];

  const shown = rows ?? [];

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
            <SelectItem value="active_week">Active this week</SelectItem>
          </SelectContent>
        </Select>

        <Select value={skill} onValueChange={setSkill}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Skill gap" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any skill</SelectItem>
            {skills.map((k) => <SelectItem key={k} value={k}>Weak at {k}</SelectItem>)}
          </SelectContent>
        </Select>

        <TpoImportStudents collegeId={collegeId} onImported={() => void load()} />
        <Button variant="outline" onClick={() => setAssignOpen(true)}>
          <ClipboardList className="h-4 w-4 mr-2" />
          Assign Task
        </Button>
        {/* stage70: written-task submissions the AI grader flagged for a
            human - a close match to another student's answer, a
            disagreement between the two graders, or an AI-authorship flag. */}
        <Button variant="outline" onClick={() => setReviewOpen(true)}>
          <FlagTriangleRight className="h-4 w-4 mr-2" />
          Flagged Submissions
          {pendingReviews > 0 && (
            <Badge variant="destructive" className="ml-2" aria-label={`${pendingReviews} waiting for review`}>
              {pendingReviews}
            </Badge>
          )}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-baseline mb-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {total === 0 ? "none" : `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, total)} of ${total}`}
              {loading && " · loading"}
            </span>
            {skill !== "all" && (
              <Badge variant="outline" className="ml-3 font-normal cursor-pointer"
                     onClick={() => setSkill("all")}>
                weak at {skill} ✕
              </Badge>
            )}
            {picked.size > 0 && (
              <Button size="sm" variant="destructive" className="ml-3 h-7" disabled={removing}
                      onClick={() => void remove([...picked], `${picked.size} selected student${picked.size === 1 ? "" : "s"}`)}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove selected ({picked.size})
              </Button>
            )}
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              matching these filters
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-2 w-6">
                    <input type="checkbox" aria-label="Select all on this page"
                           checked={shown.length > 0 && shown.every((r) => picked.has(r.student_id))}
                           onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.student_id)) : new Set())} />
                  </th>
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
                    <td className="py-2.5 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${r.full_name}`}
                             checked={picked.has(r.student_id)} onChange={() => togglePick(r.student_id)} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{r.full_name}</div>
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-xs">
                      {r.roll_number ?? "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{r.branch ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      {r.is_reserve ? (
                        <Badge variant="outline" className="font-normal">Reserve</Badge>
                      ) : (
                        <button
                          type="button"
                          className="hover:text-primary hover:underline"
                          onClick={(e) => { e.stopPropagation(); if (r.squad_id) onOpenSquad?.(r.squad_id); }}
                        >
                          {r.squad_name}
                        </button>
                      )}
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
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive"
                              disabled={removing} title="Remove student"
                              onClick={(e) => { e.stopPropagation(); void remove([r.student_id], r.full_name); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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
                {shown.length === 0 && !loading && (
                  <tr><td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No students match these filters.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {total > PAGE && (
            <div className="flex items-center gap-3 mt-4 pt-3 border-t">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                page {page + 1} of {Math.ceil(total / PAGE)}
              </span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0 || loading}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  Previous
                </Button>
                <Button size="sm" variant="outline"
                        disabled={(page + 1) * PAGE >= total || loading}
                        onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <TpoStudentProfile
        studentId={openStudent}
        onClose={() => setOpenStudent(null)}
        onOpenSquad={onOpenSquad}
        onChanged={() => void load()}
      />

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="sr-only">Assign Task</DialogTitle>
          </DialogHeader>
          <AssignTasksScreen scope="college" />
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="sr-only">Flagged Submissions</DialogTitle>
          </DialogHeader>
          <ReviewedSubmissions />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TpoStudents;
