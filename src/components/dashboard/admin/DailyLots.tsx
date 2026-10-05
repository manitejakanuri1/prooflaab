import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Daily Lots, read-only (admin_daily_lots, migration 88). Shows each student's Lot for a day with
 * where it came from, why it was chosen, the submitted work, its score breakdown and the voice result.
 * Every field is a stored value; nothing here is written or re-scored. No approval step.
 */
interface Row {
  task_id: string; student_name: string; college: string | null; title: string; lot_date: string;
  task_status: string; difficulty: string | null; grading_mode: "sandbox" | "rubric" | null;
  skills: string[] | null; topic: string | null; rule: string | null; why_selected: string;
  provenance: { page_title?: string; url?: string; source_name?: string; domain?: string; rights_flag?: string } | null;
  submission: {
    status: string; score: number | null; passed: number | null; total: number | null; attempts: number;
    language: string | null; flags: string[] | null; submitted_at: string; answer: string | null;
    tests: { id: string; passed: boolean; verdict: string | null; visible: boolean }[] | null;
    rubric: { criterion: string; points: number; max_points: number | null; reason: string | null }[] | null;
  } | null;
  voice: { status: string; communication_score: number | null; content_match: number | null; flags: string[] | null; notes: string | null } | null;
}

const PAGE = 50;
const today = () => new Date().toISOString().slice(0, 10);

const DailyLots = () => {
  const [date, setDate] = useState(today());
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    supabase.rpc("admin_daily_lots" as never, { _date: date, _q: q, _limit: PAGE, _offset: page * PAGE } as never)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) { setError(e.message); setRows([]); setTotal(0); }
        else {
          const d = data as unknown as { rows: Row[]; total: number };
          setRows(d?.rows ?? []);
          setTotal(d?.total ?? 0);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [date, q, page]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>Daily Lots</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(0); }} className="w-44" />
          <Input placeholder="Student or Lot title" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} className="w-64" />
          <span className="self-center text-sm text-muted-foreground">{total} Lots on this day</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && rows.length === 0 && <p className="text-sm text-muted-foreground">No Lots on this day.</p>}
        {rows.map((r) => {
          const s = r.submission;
          const isOpen = open === r.task_id;
          return (
            <div key={r.task_id} className="rounded-lg border p-3 space-y-2">
              <button className="w-full text-left" onClick={() => setOpen(isOpen ? null : r.task_id)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{r.student_name} <span className="text-muted-foreground font-normal">· {r.college ?? "no college"}</span></p>
                    <p className="text-sm">{r.title}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(r.skills ?? []).map((k) => <Badge key={k} variant="secondary">{k}</Badge>)}
                    {r.difficulty && <Badge variant="outline">{r.difficulty}</Badge>}
                    {r.grading_mode && <Badge variant="outline">{r.grading_mode === "sandbox" ? "code tests" : "rubric"}</Badge>}
                    <Badge>{s ? s.status : "not submitted"}</Badge>
                    {s?.score != null && <Badge variant="outline">{s.score}/100</Badge>}
                    {r.voice?.communication_score != null && <Badge variant="outline">voice {r.voice.communication_score}</Badge>}
                    {(s?.flags?.length ?? 0) > 0 && <Badge variant="destructive">flagged</Badge>}
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="space-y-2 text-sm">
                  <p><span className="font-medium">Why selected{r.rule ? ` (${r.rule})` : ""}:</span> {r.why_selected}</p>
                  <p className="text-muted-foreground">
                    Source: {r.provenance?.source_name ?? "—"}{r.provenance?.domain ? ` (${r.provenance.domain})` : ""}
                    {r.provenance?.page_title ? ` · page "${r.provenance.page_title}"` : ""}
                    {r.provenance?.rights_flag ? ` · rights ${r.provenance.rights_flag}` : ""}
                    {r.provenance?.url && <> · <span className="break-all">{r.provenance.url}</span></>}
                  </p>
                  {s && (
                    <>
                      <p>
                        Result: {s.status}{s.score != null ? ` · ${s.score}/100` : ""}
                        {s.total != null ? ` · tests ${s.passed ?? 0}/${s.total}` : ""} · {s.attempts} attempt{s.attempts === 1 ? "" : "s"}
                        {s.flags?.length ? ` · flags: ${s.flags.join(", ")}` : ""}
                      </p>
                      {s.tests && s.tests.length > 0 && (
                        <p className="text-muted-foreground">
                          Tests: {s.tests.map((t) => `${t.id} ${t.passed ? "passed" : (t.verdict ?? "failed")}${t.visible ? "" : " (hidden)"}`).join(" · ")}
                        </p>
                      )}
                      {s.rubric && s.rubric.length > 0 && (
                        <ul className="space-y-0.5">
                          {s.rubric.map((c) => (
                            <li key={c.criterion}>{c.criterion}: {c.points}/{c.max_points ?? "?"}{c.reason ? <span className="text-muted-foreground"> — "{c.reason}"</span> : null}</li>
                          ))}
                        </ul>
                      )}
                      {s.answer && (
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs font-mono">{s.answer}</pre>
                      )}
                    </>
                  )}
                  {r.voice && (
                    <p>
                      Voice: {r.voice.status}
                      {r.voice.communication_score != null ? ` · communication ${r.voice.communication_score}/100` : ""}
                      {r.voice.content_match != null ? ` · matches the work ${r.voice.content_match}/100` : ""}
                      {r.voice.flags?.length ? ` · flags: ${r.voice.flags.join(", ")}` : ""}
                      {r.voice.notes ? <span className="block text-muted-foreground">{r.voice.notes}</span> : null}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {total > PAGE && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-sm text-muted-foreground">Page {page + 1} of {Math.ceil(total / PAGE)}</span>
            <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DailyLots;
