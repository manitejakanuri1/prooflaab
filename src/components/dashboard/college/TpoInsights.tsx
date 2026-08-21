import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface SkillGap { skill: string; students: number }
interface SquadHealth {
  name: string; points: number; wins: number; losses: number;
  members: number; active_members: number;
}
interface Insights {
  students: number;
  participation_this_week: number;
  participation_last_week: number;
  skill_gaps: SkillGap[];
  squad_health: SquadHealth[];
  attention_total: number;
  error?: string;
}

interface Props {
  onFilterStudents?: (reasonCode: string) => void;
}

/**
 * Insights — "where should I intervene?"
 *
 * Every number here is counted across every student in the college, which is
 * why it comes from one function rather than from the browser reading rows. It
 * is also why this screen is honest about having nothing to say early on: a
 * participation trend drawn from one week of data is decoration.
 */
const TpoInsights = ({ onFilterStudents }: Props) => {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.rpc("tpo_insights" as never);
    if (err) { setError(err.message); return; }
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
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
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

        <Card>
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

        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Students
            </span>
            <div className="font-mono text-3xl font-bold tabular-nums mt-1">{data.students}</div>
            <p className="text-xs text-muted-foreground mt-0.5">in this college</p>
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
                  <div key={g.skill} className="flex items-center gap-3 py-3 border-b last:border-b-0">
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
                      <Button size="sm" variant="outline" onClick={() => onFilterStudents?.("all")}>
                        View
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
                    <div key={s.name} className="py-3 border-b last:border-b-0">
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
    </div>
  );
};

export default TpoInsights;
