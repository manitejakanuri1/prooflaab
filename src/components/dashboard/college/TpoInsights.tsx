import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";

interface SkillGap { skill: string; students: number }
interface SquadHealth {
  id: string; name: string; points: number; wins: number; losses: number;
  members: number; active_members: number;
}
interface Branch { branch: string; students: number; active_week: number; in_squads: number }
interface Trend {
  squad_id: string; squad: string; week: number; points: number; change: number | null;
}
interface Hire { student: string; company: string; hired_on: string | null }
interface Placement {
  pipeline: Record<string, number>; hired_total: number;
  hires: Hire[]; by_company: { company: string; hires: number }[]; error?: string;
}
interface Season {
  id: string; name: string; status: string; is_current: boolean;
  starts_on: string; ends_on: string; completed_at: string | null;
  champion: string | null; runner_up: string | null; third: string | null; squads: number;
}
interface Report { branches: Branch[]; squad_trends: Trend[]; seasons: Season[]; error?: string }

interface Insights {
  students: number;
  active_today: number;
  participation_this_week: number;
  participation_last_week: number;
  skill_gaps: SkillGap[];
  squad_health: SquadHealth[];
  attention_total: number;
  error?: string;
}

interface Props {
  onFilterStudents?: (reasonCode: string) => void;
  /** "Show me the four who need SQL." */
  onFilterSkill?: (skill: string) => void;
  onOpenSquad?: (squadId: string) => void;
  onNavigate?: (tab: string) => void;
}

/**
 * Insights — "where should I intervene?"
 *
 * Every number here is counted across every student in the college, which is
 * why it comes from one function rather than from the browser reading rows. It
 * is also why this screen is honest about having nothing to say early on: a
 * participation trend drawn from one week of data is decoration.
 */
const TpoInsights = ({ onFilterStudents, onFilterSkill, onOpenSquad, onNavigate }: Props) => {
  const [data, setData] = useState<Insights | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Three functions rather than one: tpo_insights answers "where do I step
    // in", the report answers "how is the college doing", and placement
    // answers "did any of this lead anywhere" — three different rhythms.
    const [{ data: res, error: err }, { data: rep }, { data: plc }] = await Promise.all([
      supabase.rpc("tpo_insights" as never),
      supabase.rpc("tpo_college_report" as never),
      supabase.rpc("tpo_placement_report" as never),
    ]);
    if (err) { setError(err.message); return; }
    setReport(rep as unknown as Report);
    setPlacement(plc as unknown as Placement);
    const d = res as unknown as Insights;
    if (d?.error) { setError(d.error); return; }
    setData(d);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return <Card><CardContent className="pt-6">
      <p className="text-sm text-muted-foreground">{error}</p></CardContent></Card>;
  }
  if (!data) return <Skeleton className="h-80 w-full rounded-xl" />;

  /**
   * The weekly report, built from the same rows the screen is showing rather
   * than from a second query — so the file a principal reads and the screen an
   * officer read cannot disagree.
   */
  const exportWeekly = async () => {
    const { data: students } = await supabase.rpc("tpo_students" as never);
    const list = (students ?? []) as unknown as Array<Record<string, unknown>>;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

    const lines: string[] = [];
    lines.push(`ProofLab weekly report,${new Date().toLocaleDateString()}`);
    lines.push("");
    lines.push("Summary");
    lines.push(`Students,${data.students}`);
    lines.push(`Active this week (%),${data.participation_this_week}`);
    lines.push(`Active last week (%),${data.participation_last_week}`);
    lines.push(`Needs attention,${data.attention_total}`);
    lines.push("");
    lines.push("Skill gaps");
    lines.push("Skill,Students needing improvement");
    data.skill_gaps.forEach((g) => lines.push(`${esc(g.skill)},${g.students}`));
    lines.push("");
    lines.push("Squad health");
    lines.push("Squad,Members,Active members,Points,Won,Lost");
    data.squad_health.forEach((h) =>
      lines.push([esc(h.name), h.members, h.active_members, h.points, h.wins, h.losses].join(",")));
    lines.push("");
    lines.push("Students");
    lines.push("Name,Roll number,Branch,Squad,Days since active,Lots completed,Status");
    list.forEach((r) => lines.push([
      esc(r.full_name), esc(r.roll_number), esc(r.branch),
      esc(r.is_reserve ? "Reserve" : r.squad_name),
      r.days_quiet, r.lots_done, esc(r.attention),
    ].join(",")));

    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `prooflab-weekly-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const branches = report?.branches ?? [];
  const trends = report?.squad_trends ?? [];
  const seasons = report?.seasons ?? [];
  const delta = data.participation_this_week - data.participation_last_week;
  const healthy = data.squad_health.filter(
    (s) => s.members > 0 && s.active_members / s.members >= 0.7).length;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">
          Participation, skills, squad health and where to step in.
        </p>
        <Button size="sm" variant="outline" className="ml-auto"
                onClick={() => void exportWeekly()}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export weekly report
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="cursor-pointer transition-colors hover:border-primary"
              onClick={() => onFilterStudents?.("active_week")}>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Active this week
            </span>
            <div className="font-mono text-3xl font-bold tabular-nums mt-1">
              {data.participation_this_week}%
            </div>
            <p className={`text-xs mt-0.5 ${delta < 0 ? "text-destructive" : delta > 0 ? "text-emerald-500" : "text-muted-foreground"}`}>
              {delta === 0 ? "unchanged on last week"
                : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)} points on last week`}
            </p>
          </CardContent>
        </Card>

        <Card
          className={data.attention_total > 0 ? "cursor-pointer transition-colors hover:border-primary" : ""}
          onClick={data.attention_total > 0 ? () => onFilterStudents?.("all") : undefined}
        >
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Needs attention
            </span>
            <div className={`font-mono text-3xl font-bold tabular-nums mt-1 ${
              data.attention_total > 0 ? "text-destructive" : ""}`}>
              {data.attention_total}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.attention_total > 0 ? "tap to see who" : "nobody is behind"}
            </p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer transition-colors hover:border-primary"
              onClick={() => onNavigate?.("squads")}>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Squads healthy
            </span>
            <div className="font-mono text-3xl font-bold tabular-nums mt-1">
              {healthy}/{data.squad_health.length}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              70% of members active counts as healthy
            </p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer transition-colors hover:border-primary"
              onClick={() => onNavigate?.("students")}>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Students
            </span>
            <div className="font-mono text-3xl font-bold tabular-nums mt-1">{data.students}</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.active_today} active today · open the list
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Skill gaps
            </span>
            {data.skill_gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-3 max-w-prose">
                Nothing measured yet. A skill only appears here once it has been assessed and
                come back weak — a gap nobody has tested for is a guess, not a gap.
              </p>
            ) : (
              <div className="mt-2">
                {data.skill_gaps.map((g) => (
                  <div key={g.skill}
                       className="flex items-center gap-3 py-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1"
                       onClick={() => onFilterSkill?.(g.skill)}>
                    <div>
                      <p className="text-sm font-medium">{g.skill}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.students} {g.students === 1 ? "student needs" : "students need"} improvement
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-3">
                      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary"
                             style={{ width: `${Math.min(100, Math.round(g.students / Math.max(data.students, 1) * 100))}%` }} />
                      </div>
                      <Button size="sm" variant="outline"
                              onClick={(e) => { e.stopPropagation(); onFilterSkill?.(g.skill); }}>
                        View {g.students}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Squad health
            </span>
            {data.squad_health.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-3">No squads yet.</p>
            ) : (
              <div className="mt-2">
                {data.squad_health.map((s) => {
                  const pct = s.members === 0 ? 0 : Math.round(s.active_members / s.members * 100);
                  return (
                    <div key={s.id}
                         className="py-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1"
                         onClick={() => onOpenSquad?.(s.id)}>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-medium">{s.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {s.active_members}/{s.members} active
                        </span>
                        <span className="ml-auto">
                          {pct >= 70
                            ? <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">Healthy</Badge>
                            : <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">Needs attention</Badge>}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full ${pct >= 70 ? "bg-emerald-500" : "bg-amber-500"}`}
                             style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Branch activity
            </span>
            {branches.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-3">No students imported yet.</p>
            ) : (
              <div className="mt-2">
                {branches.map((b) => {
                  const pct = b.students === 0
                    ? 0 : Math.round((b.active_week / b.students) * 100);
                  return (
                    <div key={b.branch} className="py-3 border-b last:border-b-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-medium">{b.branch}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {b.active_week}/{b.students} active this week
                        </span>
                        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                          {b.in_squads} in squads
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={pct >= 70 ? "h-full bg-emerald-500" : "h-full bg-amber-500"}
                             style={{ width: pct + "%" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Squad trends
            </span>
            {trends.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-3 max-w-prose">
                Nothing to compare yet. A trend needs two scored weeks — after the second Monday
                this shows which squads are climbing and which are falling away.
              </p>
            ) : (
              <div className="mt-2">
                {trends.map((t) => (
                  <div key={t.squad_id}
                       className="flex items-center gap-3 py-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1"
                       onClick={() => onOpenSquad?.(t.squad_id)}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t.squad}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.points} points in week {t.week}
                      </p>
                    </div>
                    <span className="ml-auto font-mono text-sm tabular-nums">
                      {t.change == null ? (
                        <span className="text-muted-foreground">first week</span>
                      ) : t.change >= 0 ? (
                        <span className="text-emerald-500">+{t.change}</span>
                      ) : (
                        <span className="text-destructive">{t.change}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Season results
          </span>
          {seasons.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3 max-w-prose">
              No season has been run yet. A season is what the weekly scores add up to — it opens
              with the squads you have and closes with a champion, a runner-up and a third.
            </p>
          ) : (
            <div className="mt-2">
              {seasons.map((s) => (
                <div key={s.id} className="py-3 border-b last:border-b-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium">{s.name}</span>
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {s.is_current ? "Running" : s.status}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.squads} squads
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {s.starts_on} → {s.ends_on}
                    </span>
                  </div>
                  {s.champion ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {[
                        { k: "Champion", v: s.champion },
                        { k: "Runner-up", v: s.runner_up },
                        { k: "Third", v: s.third },
                      ].map(({ k, v }) => (
                        <div key={k} className="rounded-lg bg-muted/50 p-3">
                          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            {k}
                          </span>
                          <div className="text-sm font-semibold mt-0.5">{v ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Still running. The podium is filled in when the season closes.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {placement && !placement.error && (
        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Placements
            </span>
            {placement.hired_total === 0 ? (
              <p className="text-sm text-muted-foreground mt-3 max-w-prose">
                No hires recorded yet. This fills in as recruiters mark a shortlisted student
                hired — the same evidence trail as everything else here, not a claim anyone typed in.
              </p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Hired
                    </span>
                    <div className="font-mono text-xl font-semibold tabular-nums mt-1">
                      {placement.hired_total}
                    </div>
                  </div>
                  {Object.entries(placement.pipeline)
                    .filter(([stage]) => stage !== "hired")
                    .map(([stage, n]) => (
                      <div key={stage} className="rounded-lg bg-muted/50 p-3">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground capitalize">
                          {stage}
                        </span>
                        <div className="font-mono text-xl font-semibold tabular-nums mt-1">{n}</div>
                      </div>
                    ))}
                </div>
                <div className="mt-3">
                  {placement.hires.map((h, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0">
                      <span className="text-sm">{h.student}</span>
                      <span className="text-sm text-muted-foreground">{h.company}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {h.hired_on ? new Date(h.hired_on).toLocaleDateString() : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TpoInsights;
