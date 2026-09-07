import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Activity, AlertTriangle, Shield, Upload, Trophy } from "lucide-react";
import PostJobDescription from "./PostJobDescription";

interface AttentionLine {
  reason_code: string;
  reason: string;
  students: number;
  who: string[];
}

interface HomeSnapshot {
  students: number;
  active_this_week: number;
  active_today: number;
  needs_attention: number;
  squads: number;
  reserves: number;
  season: { id: string; name: string; week: number; planned_weeks: number } | null;
  leader: { id: string; name: string; points: number } | null;
  attention_breakdown: AttentionLine[];
  error?: string;
}

interface Standing {
  id: string; name: string; points: number; wins: number; losses: number;
}

interface Props {
  onNavigate?: (tab: string) => void;
  onFilterStudents?: (reasonCode: string) => void;
  onOpenSquad?: (squadId: string) => void;
}

/**
 * Home — "what needs my attention?"
 *
 * The whole argument of the TPO spec is on this screen: it names people rather
 * than counting events. Every line in the attention panel opens the student list
 * already filtered, because an officer who has to search again has been told
 * nothing useful.
 *
 * One call rather than six. The snapshot needs students, activity, onboarding,
 * squads and the season together, and six round trips to paint a screen
 * somebody looks at for ten seconds is five too many.
 */
const TpoHome = ({ onNavigate, onFilterStudents, onOpenSquad }: Props) => {
  const [data, setData] = useState<HomeSnapshot | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.rpc("tpo_home" as never);
    if (err) { setError(err.message); return; }
    const snap = res as unknown as HomeSnapshot;
    if (snap?.error) { setError(snap.error); return; }
    setData(snap);

    // Standings are read straight from the squads table rather than folded into
    // tpo_home: it is a plain list a rule already permits, and putting it in the
    // snapshot would make one call slower for every screen that does not show it.
    const cid = await supabase.rpc("my_college_id" as never);
    const collegeId = cid.data as unknown as string | null;
    if (collegeId) {
      const { data: sq } = await supabase
        .from("squads").select("id, name, points, wins, losses")
        .eq("college_id", collegeId)
        .order("points", { ascending: false });
      setStandings((sq ?? []) as unknown as Standing[]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }
  if (!data) return <Skeleton className="h-72 w-full rounded-xl" />;

  // Every card leads somewhere, because a number with nowhere to go is a number
  // the officer has to act on by hand. The only one that stays inert is a zero
  // — there is nothing to show behind "0 need attention".
  const cards = [
    { key: "students", label: "Students", value: data.students, icon: Users,
      note: `${data.active_this_week} active this week · open the list`,
      action: () => onNavigate?.("students") },
    { key: "today", label: "Active today", value: data.active_today, icon: Activity,
      note: data.active_today > 0 ? "signed in or submitted today" : "nobody yet today",
      tone: "good" as const, action: () => onFilterStudents?.("active_today") },
    { key: "attention", label: "Needs attention", value: data.needs_attention, icon: AlertTriangle,
      note: data.needs_attention > 0 ? "tap to see who" : "nobody, for once",
      tone: "hot" as const, action: () => onFilterStudents?.("all") },
    { key: "squads", label: "Squads", value: data.squads, icon: Shield,
      note: `${data.reserves} in reserve · open standings`,
      action: () => onNavigate?.("squads") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Home</h1>
        <p className="text-sm text-muted-foreground">
          Pilot health and what needs your attention.
        </p>
        <div className="ml-auto">
          <PostJobDescription />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          const clickable = Boolean(c.action) && c.value > 0;
          return (
            <Card
              key={c.key}
              // Only clickable when there is somewhere useful to go. The spec is
              // explicit that a static metric should look like information, not
              // like a button that does nothing.
              className={clickable ? "cursor-pointer transition-colors hover:border-primary" : ""}
              onClick={clickable ? c.action : undefined}
            >
              <CardContent className="pt-5">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.label}
                  </span>
                </div>
                <div className={`font-mono text-3xl font-bold tabular-nums mt-1 ${
                  c.tone === "hot" && c.value > 0 ? "text-destructive"
                  : c.tone === "good" ? "text-emerald-500" : ""}`}>
                  {c.value}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.note}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-baseline">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Needs attention
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                tap a line to open the filtered list
              </span>
            </div>

            {data.attention_breakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-4">
                Nobody is behind. Every student has been active this week and finished onboarding.
              </p>
            ) : (
              <div className="mt-2">
                {data.attention_breakdown.map((line) => (
                  <div key={line.reason_code} className="flex items-center gap-3 py-3 border-b last:border-b-0 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {line.students} {line.students === 1 ? "student" : "students"} {line.reason}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {line.who.slice(0, 4).join(" · ")}
                        {line.who.length > 4 ? ` +${line.who.length - 4} more` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={line.reason_code === "inactive" ? "default" : "outline"}
                      className="ml-auto"
                      onClick={() => onFilterStudents?.(line.reason_code)}
                    >
                      View
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Quick actions
              </span>
              <div className="grid gap-2 mt-3">
                <Button size="sm" onClick={() => onNavigate?.("students")}>
                  Import students
                </Button>
                <Button size="sm" variant="outline" onClick={() => onNavigate?.("students")}>
                  View students
                </Button>
                <Button size="sm" variant="outline" onClick={() => onNavigate?.("squads")}>
                  View squads
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 space-y-3">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Season
                </span>
                {data.season ? (
                  <p className="text-lg font-semibold mt-0.5">
                    Week {data.season.week}
                    <span className="text-muted-foreground font-normal"> of {data.season.planned_weeks}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">No season running.</p>
                )}
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Leading squad
                </span>
                {data.leader ? (
                  <button
                    type="button"
                    className="text-lg font-semibold mt-0.5 flex items-center gap-2 hover:text-primary transition-colors"
                    onClick={() => onOpenSquad?.(data.leader!.id)}
                  >
                    <Trophy className="h-4 w-4 text-primary" />
                    {data.leader.name}
                    <span className="font-mono text-sm text-muted-foreground">{data.leader.points} pts</span>
                  </button>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">No squads yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-baseline">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Weekly squad standings
            </span>
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs"
                    onClick={() => onNavigate?.("squads")}>
              Open squads
            </Button>
          </div>

          {standings.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">
              No squads yet. A squad belongs to a season — create one and students can be drawn
              into it from the reserve pool.
            </p>
          ) : (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm min-w-[380px]">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="pb-2 pr-3">Rank</th>
                    <th className="pb-2 pr-3">Squad</th>
                    <th className="pb-2 pr-3">Record</th>
                    <th className="pb-2">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => (
                    <tr key={s.id} className="border-t cursor-pointer hover:bg-muted/40"
                        onClick={() => onOpenSquad?.(s.id)}>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{i + 1}</td>
                      <td className="py-2.5 pr-3 font-medium">{s.name}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{s.wins}–{s.losses}</td>
                      <td className={`py-2.5 font-mono tabular-nums font-semibold ${i === 0 ? "text-primary" : ""}`}>
                        {s.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TpoHome;
