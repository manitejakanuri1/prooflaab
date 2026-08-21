import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Activity, AlertTriangle, Shield, Upload, Trophy } from "lucide-react";

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

interface Props {
  onNavigate?: (tab: string) => void;
  onFilterStudents?: (reasonCode: string) => void;
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
const TpoHome = ({ onNavigate, onFilterStudents }: Props) => {
  const [data, setData] = useState<HomeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.rpc("tpo_home" as never);
    if (err) { setError(err.message); return; }
    const snap = res as unknown as HomeSnapshot;
    if (snap?.error) { setError(snap.error); return; }
    setData(snap);
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

  const cards = [
    { key: "students", label: "Students", value: data.students, icon: Users,
      note: `${data.active_this_week} active this week` },
    { key: "today", label: "Active today", value: data.active_today, icon: Activity,
      note: "signed in or submitted", tone: "good" as const },
    { key: "attention", label: "Needs attention", value: data.needs_attention, icon: AlertTriangle,
      note: data.needs_attention > 0 ? "tap to see who" : "nobody, for once",
      tone: "hot" as const, action: () => onFilterStudents?.("all") },
    { key: "squads", label: "Squads", value: data.squads, icon: Shield,
      note: `${data.reserves} in reserve` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Home</h1>
        <p className="text-sm text-muted-foreground">
          Pilot health and what needs your attention.
        </p>
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
                  <p className="text-lg font-semibold mt-0.5 flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    {data.leader.name}
                    <span className="font-mono text-sm text-muted-foreground">{data.leader.points} pts</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">No squads yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default TpoHome;
