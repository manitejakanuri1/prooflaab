import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

/**
 * Admin "Student Trace": the step trail the student area records (see src/lib/tracker.ts).
 *  - Timeline: search a student, see every step in order, failures marked.
 *  - Funnels: how many students reached each step of resume, lessons, daily task, voice.
 *  - Errors and slow calls: what fails most, and what is slowest.
 * Reads only through the admin_trace_* database functions, which refuse anyone who is not an admin.
 */

type Student = { student_id: string; full_name: string | null; email: string | null; roll_number: string | null; events_7d: number; last_seen: string | null };
type Ev = { created_at: string; session_id: string | null; request_id: string | null; kind: string; screen: string | null; action: string | null; target: string | null; status: string | null; duration_ms: number | null; detail: { message?: string; http?: number } | null };
type FunnelRow = { funnel: string; step_order: number; step_label: string; students: number; calls: number; errors: number };
type ErrRow = { where_: string; what: string; times: number; students: number; last_seen: string };
type SlowRow = { target: string; calls: number; avg_ms: number; p95_ms: number; max_ms: number };

const call = async <T,>(fn: string, args: Record<string, unknown>): Promise<T[]> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return (data as unknown as T[]) ?? [];
};

const KIND_LABEL: Record<string, string> = { page: "Opened", click: "Pressed", call: "Server call", error: "Error" };

const Timeline = () => {
  const [q, setQ] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [picked, setPicked] = useState<Student | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [hours, setHours] = useState(72);
  const [err, setErr] = useState<string | null>(null);

  const search = useCallback(async () => {
    setErr(null);
    try { setStudents(await call<Student>("admin_trace_search", { _q: q })); } catch (e) { setErr((e as Error).message); }
  }, [q]);
  useEffect(() => { void search(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const open = async (s: Student) => {
    setPicked(s);
    setErr(null);
    try { setEvents(await call<Ev>("admin_trace_student", { _student_id: s.student_id, _hours: hours, _limit: 500 })); } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (picked) void open(picked); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [hours]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input id="trace-search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} placeholder="Search by name, email or roll number" className="max-w-sm" />
        <Button onClick={() => void search()}>Search</Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-sm">Students</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {students.length === 0 && <p className="text-sm text-muted-foreground">No students found.</p>}
            {students.map((s) => (
              <button key={s.student_id} type="button" onClick={() => void open(s)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted ${picked?.student_id === s.student_id ? "border-primary bg-muted" : ""}`}>
                <div className="font-medium">{s.full_name ?? "(no name)"}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{s.events_7d} steps in 7 days{s.last_seen ? ` · last ${format(new Date(s.last_seen), "d MMM HH:mm")}` : " · never seen"}</div>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm">{picked ? `Steps of ${picked.full_name ?? "student"}` : "Pick a student"}</CardTitle>
            <div className="flex gap-1">
              {[24, 72, 168].map((h) => (
                <Button key={h} size="sm" variant={hours === h ? "default" : "outline"} onClick={() => setHours(h)}>{h === 24 ? "24 h" : h === 72 ? "3 days" : "7 days"}</Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {picked && events.length === 0 && <p className="text-sm text-muted-foreground">No steps recorded in this period.</p>}
            {events.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>What</TableHead><TableHead>Where</TableHead><TableHead>Result</TableHead><TableHead className="text-right">ms</TableHead></TableRow></TableHeader>
                <TableBody>
                  {events.map((e, i) => (
                    <TableRow key={i} className={e.status === "error" ? "bg-destructive/5" : ""}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{format(new Date(e.created_at), "d MMM HH:mm:ss")}</TableCell>
                      <TableCell><Badge variant="outline">{KIND_LABEL[e.kind] ?? e.kind}</Badge> <span className="text-sm">{e.action ?? e.target ?? ""}</span></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.screen ?? (e.kind === "call" ? e.target : "")}</TableCell>
                      <TableCell className="text-xs">{e.status === "error" ? <span className="text-destructive">failed{e.detail?.http ? ` (${e.detail.http})` : ""}{e.detail?.message ? `: ${e.detail.message}` : ""}</span> : e.status === "ok" ? "ok" : ""}{e.request_id && <div className="font-mono text-[10px] text-muted-foreground" title="Search this id in Google Cloud Logs Explorer">{e.request_id}</div>}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{e.duration_ms ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const Funnels = () => {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { call<FunnelRow>("admin_trace_funnels", { _days: days }).then(setRows, (e) => setErr(e.message)); }, [days]);
  const groups = useMemo(() => {
    const m = new Map<string, FunnelRow[]>();
    rows.forEach((r) => m.set(r.funnel, [...(m.get(r.funnel) ?? []), r]));
    return [...m.entries()];
  }, [rows]);
  return (
    <div className="space-y-4">
      <div className="flex gap-1">{[1, 7, 30].map((d) => <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>{d === 1 ? "Today" : `${d} days`}</Button>)}</div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map(([name, steps]) => {
          const top = Math.max(1, steps[0]?.students ?? 0, ...steps.map((s) => s.students));
          return (
            <Card key={name}>
              <CardHeader><CardTitle className="text-sm">{name}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {steps.map((s) => (
                  <div key={s.step_label}>
                    <div className="flex items-baseline justify-between text-sm"><span>{s.step_label}</span><span className="font-mono text-xs">{s.students} students{s.errors > 0 ? ` · ${s.errors} failed` : ""}</span></div>
                    <div className="mt-1 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.round((s.students / top) * 100)}%` }} /></div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">A step counts a student once, only when the call worked. A big drop between two steps is where students give up or something is failing.</p>
    </div>
  );
};

const Problems = () => {
  const [days, setDays] = useState(7);
  const [errors, setErrors] = useState<ErrRow[]>([]);
  const [slow, setSlow] = useState<SlowRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    call<ErrRow>("admin_trace_errors", { _days: days }).then(setErrors, (e) => setErr(e.message));
    call<SlowRow>("admin_trace_slow", { _days: days }).then(setSlow, (e) => setErr(e.message));
  }, [days]);
  return (
    <div className="space-y-4">
      <div className="flex gap-1">{[1, 7, 30].map((d) => <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>{d === 1 ? "Today" : `${d} days`}</Button>)}</div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card>
        <CardHeader><CardTitle className="text-sm">Top errors</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {errors.length === 0 ? <p className="text-sm text-muted-foreground">No errors recorded in this period.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Where</TableHead><TableHead>What</TableHead><TableHead className="text-right">Times</TableHead><TableHead className="text-right">Students</TableHead><TableHead>Last</TableHead></TableRow></TableHeader>
              <TableBody>{errors.map((r, i) => (
                <TableRow key={i}><TableCell className="font-mono text-xs">{r.where_}</TableCell><TableCell className="text-sm">{r.what}</TableCell><TableCell className="text-right font-mono">{r.times}</TableCell><TableCell className="text-right font-mono">{r.students}</TableCell><TableCell className="whitespace-nowrap text-xs">{format(new Date(r.last_seen), "d MMM HH:mm")}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Slowest calls (95th percentile)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {slow.length === 0 ? <p className="text-sm text-muted-foreground">Not enough calls yet (needs at least 3 per call).</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Call</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Average ms</TableHead><TableHead className="text-right">Slowest 5% ms</TableHead><TableHead className="text-right">Max ms</TableHead></TableRow></TableHeader>
              <TableBody>{slow.map((r) => (
                <TableRow key={r.target}><TableCell className="font-mono text-xs">{r.target}</TableCell><TableCell className="text-right font-mono">{r.calls}</TableCell><TableCell className="text-right font-mono">{r.avg_ms}</TableCell><TableCell className="text-right font-mono">{r.p95_ms}</TableCell><TableCell className="text-right font-mono">{r.max_ms}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const StudentTrace = () => {
  const [tab, setTab] = useState<"timeline" | "funnels" | "problems">("timeline");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Student Trace</h2>
        <p className="text-muted-foreground">Every step students take in the app: what they opened, pressed, which server call ran and whether it worked. Steps only, never what they typed. Kept 90 days.</p>
      </div>
      <div className="flex gap-2">
        {([["timeline", "Student timeline"], ["funnels", "Funnels"], ["problems", "Errors and slow calls"]] as const).map(([id, name]) => (
          <Button key={id} variant={tab === id ? "default" : "outline"} onClick={() => setTab(id)}>{name}</Button>
        ))}
      </div>
      {tab === "timeline" && <Timeline />}
      {tab === "funnels" && <Funnels />}
      {tab === "problems" && <Problems />}
    </div>
  );
};

export default StudentTrace;
