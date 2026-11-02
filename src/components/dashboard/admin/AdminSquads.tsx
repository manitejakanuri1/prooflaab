import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { FAST_WEEK, WHEN_FORMAT } from "@/lib/testClock";
import SquadSwapsList from "@/components/dashboard/season/SquadSwapsList";
import { Button } from "@/components/ui/button";

// TEST website only (migration 208): move every open PRAGATI season forward one fast week (20 minutes).
function TestSeasonForward({ onMoved }: { onMoved: () => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_test_advance_season" as never, { _weeks: 1 } as never);
    setBusy(false);
    onMoved();   // E2E O3: reload the season list so its week moves too
    const seasons = ((data as { seasons?: { week_before: number; week_now: number }[] } | null)?.seasons ?? []);
    setMsg(error ? `Not moved: ${error.message}`
      : seasons.length ? seasons.map((s) => `Week ${s.week_before} -> ${s.week_now}`).join(", ") : "No open PRAGATI season.");
  };
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 pt-5">
        <Button size="sm" disabled={busy} onClick={() => void go()}>TEST: move PRAGATI season forward 1 week</Button>
        <span className="text-sm text-muted-foreground">{busy ? "Moving..." : msg || "Each week is 20 minutes on TEST; this skips to the next one now."}</span>
      </CardContent>
    </Card>
  );
}

// TEST website only (migration 209): a test date for daily Lots, the rest day, streaks and due dates.
function TestClock() {
  const [at, setAt] = useState("");
  const [now, setNow] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const show = (d: { test_now?: string; set?: boolean } | null) =>
    setNow(d?.test_now ? `${d.set ? "Test time" : "Real time"}: ${format(new Date(d.test_now), "EEE d MMM, h:mm a")}` : "");
  useEffect(() => {
    supabase.rpc("admin_test_clock" as never).then(({ data }) => show(data as never), () => {});
  }, []);
  const run = async (fn: string, args?: Record<string, unknown>) => {
    setBusy(true);
    const { data, error } = await supabase.rpc(fn as never, args as never);
    setBusy(false);
    if (error) { setMsg(`Not done: ${error.message}`); return; }
    if (fn === "admin_test_make_lots") {
      const d = data as { date: string; made: number; already_had: number; none: number };
      setMsg(`${d.date}: ${d.made} Lots made, ${d.already_had} already had one, ${d.none} got none`);
    } else { show(data as never); setMsg(""); }
  };
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 pt-5">
        <span className="text-sm font-medium">TEST clock</span>
        <input type="datetime-local" className="h-9 rounded-md border bg-background px-2 text-sm" value={at}
          onChange={(e) => setAt(e.target.value)} aria-label="Test date and time (India time)" />
        <Button size="sm" disabled={busy || !at} onClick={() => void run("admin_test_clock_set", { _at: `${at}:00+05:30` })}>Set test date</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("admin_test_clock_set", { _at: null })}>Reset to real time</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("admin_test_make_lots")}>Make today's Lots now</Button>
        <span className="text-sm text-muted-foreground">{busy ? "Working..." : msg || now}</span>
      </CardContent>
    </Card>
  );
}

// Admin: every college's current squads (members, points, secret swap codes) and every squad swap
// (migration 143, owner decision 24 Oct 2026).

// Migration 184: one row per season - a college runs one season per year group.
// Migration 193 (MF-035): the latest season per year group, so a college between seasons still shows.
interface CollegeRow {
  college_id: string; college: string; season_starts: string; squads: number; swaps: number;
  season?: string; year_group_label?: string; week?: number; phase?: string; status?: string;
}
interface SquadRow {
  id: string; name: string; cohort: string | null; points: number; rank: number | null; max_members: number;
  year_group_label?: string;
  is_locked: boolean; code: string; swap_closes: string | null;
  members: { name: string; contribution: number; joined_at: string }[];
}

export default function AdminSquads() {
  const [colleges, setColleges] = useState<CollegeRow[] | null>(null);
  const [collegeId, setCollegeId] = useState<string>("");
  const [squads, setSquads] = useState<SquadRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    supabase.rpc("admin_squads" as never, {} as never).then(({ data, error }) => {
      setError(error?.message ?? null);
      setColleges((data as CollegeRow[]) ?? []);
    });
  }, [reload]);

  useEffect(() => {
    setSquads(null);
    if (!collegeId) return;
    supabase.rpc("admin_squads" as never, { _college_id: collegeId } as never).then(({ data, error }) => {
      setError(error?.message ?? null);
      setSquads((data as SquadRow[]) ?? []);
    });
  }, [collegeId, reload]);

  const closes = squads?.find((s) => s.swap_closes)?.swap_closes;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Squads</h1>
        <p className="text-sm text-muted-foreground">Every college's squads this season, their secret swap codes, and every squad swap.</p>
      </div>
      {FAST_WEEK && <TestClock />}
      {FAST_WEEK && <TestSeasonForward onMoved={() => setReload((n) => n + 1)} />}
      {error && <p className="text-sm text-alert">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Colleges and their latest season</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <select className="border rounded-md px-3 py-2 text-sm bg-background w-full max-w-md" aria-label="College"
            value={collegeId} onChange={(e) => setCollegeId(e.target.value)}>
            <option value="">All colleges (pick one to see its squads)</option>
            {colleges?.filter((c, i, all) => all.findIndex((x) => x.college_id === c.college_id) === i).map((c) => (
              <option key={c.college_id} value={c.college_id}>
                {c.college} · {colleges.filter((x) => x.college_id === c.college_id).reduce((n, x) => n + x.squads, 0)} squads
              </option>
            ))}
          </select>
          {!!colleges?.length && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {colleges.map((c, i) => (
                <li key={i}>
                  {c.college} · {c.year_group_label ?? "—"} · {c.season ?? "Season"} · week {c.week ?? "?"} ({c.phase ?? "—"})
                  {c.status && c.status !== "running" ? " · finished, next season after the days off" : ""}
                  {" "}· {c.squads} squads · {c.swaps} swaps · from {c.season_starts}
                </li>
              ))}
            </ul>
          )}

          {collegeId && !squads && <p className="text-sm text-muted-foreground">Loading…</p>}
          {squads && !squads.length && <p className="text-sm text-muted-foreground">No squads this season yet.</p>}
          {squads && squads.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {closes && new Date(closes) > new Date()
                  ? `Swaps are open until ${FAST_WEEK ? "" : "the end of "}${format(new Date(closes).getTime() - 60000, WHEN_FORMAT)}.`
                  : "Swaps are closed for this season (first 7 days only)."}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]" data-testid="admin-squads">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">Squad</th><th className="py-2 pr-3">Section</th><th className="py-2 pr-3">Members</th>
                      <th className="py-2 pr-3">Points</th><th className="py-2 pr-3">Rank</th><th className="py-2 pr-3">Swap code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {squads.map((s) => (
                      <Fragment key={s.id}>
                        <tr className="border-t cursor-pointer hover:bg-muted/40" onClick={() => setOpen(open === s.id ? null : s.id)}>
                          <td className="py-2 pr-3 font-medium">
                            {s.name} {s.is_locked && <Badge variant="secondary">locked</Badge>}
                          </td>
                          <td className="py-2 pr-3">{s.year_group_label ? `${s.year_group_label} · ` : ""}{s.cohort ?? "—"}</td>
                          <td className="py-2 pr-3">{s.members.length} / {s.max_members}</td>
                          <td className="py-2 pr-3 font-mono">{s.points}</td>
                          <td className="py-2 pr-3">{s.rank ?? "—"}</td>
                          <td className="py-2 pr-3 font-mono">{s.code}</td>
                        </tr>
                        {open === s.id && (
                          <tr>
                            <td colSpan={6} className="pb-3">
                              <ul className="text-sm pl-4 list-disc">
                                {s.members.map((m) => (
                                  <li key={m.name + m.joined_at}>
                                    {m.name} · {m.contribution} points · joined {format(new Date(m.joined_at), "d MMM")}
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Squad swaps {collegeId ? "in this college" : "in every college"}</CardTitle></CardHeader>
        <CardContent><SquadSwapsList collegeId={collegeId || null} showCollege={!collegeId} /></CardContent>
      </Card>
    </div>
  );
}
