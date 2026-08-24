import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, ArrowRight, PartyPopper } from "lucide-react";

interface Placement { placed: boolean; company?: string; since?: string }

interface Report {
  has_season: boolean;
  season?: { name: string; weeks: number; status: string; ends_on: string };
  weekly?: { week: number; points: number }[];
  totals?: { points: number; best_week: number; weeks_active: number; weeks_total: number };
  by_activity?: Record<string, number>;
  squad?: { name: string; rank: number; points: number; record: string; my_contribution: number };
  podium?: { champion: string | null; runner_up: string | null; third: string | null };
  skills?: { proven: number; assessed: number; weak: string[] };
  ladder?: { cleared: number; started: number };
  next?: string[];
}

const ACTIVITY: Record<string, string> = {
  lot_submitted: "Lots submitted",
  proof_verified: "Proof verified",
  topic_cleared: "Topics cleared",
  voice_recorded: "Explanations",
  match_participated: "Matches played",
  active_day: "Active days",
};

/**
 * The season report — step 18's other half.
 *
 * The podium was already published; what was missing was the half the student
 * cares about. Every figure here is derived from the weekly scores rather than
 * stored, so it cannot drift from the league table it describes.
 */
const StudentSeasonReport = () => {
  const [r, setR] = useState<Report | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const load = useCallback(async () => {
    const [{ data }, { data: p }] = await Promise.all([
      supabase.rpc("my_season_report" as never),
      supabase.rpc("my_placement_status" as never),
    ]);
    setR((data ?? { has_season: false }) as unknown as Report);
    setPlacement((p ?? { placed: false }) as unknown as Placement);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!r) return <Skeleton className="h-64 w-full rounded-xl" />;

  // Hiring isn't tied to a season, so this can appear whether or not one exists.
  const placedBanner = placement?.placed ? (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="pt-5 flex items-center gap-3">
        <PartyPopper className="h-5 w-5 text-primary flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold">Placed at {placement.company}</p>
          <p className="text-xs text-muted-foreground">
            {placement.since
              ? `Since ${new Date(placement.since).toLocaleDateString()}. `
              : ""}
            This proof profile is what got you there — keep it current.
          </p>
        </div>
      </CardContent>
    </Card>
  ) : null;

  if (!r.has_season) {
    return (
      <div className="space-y-4">
        {placedBanner}
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground max-w-prose">
            No season yet. Once your college starts one and the first week is scored, this
            becomes your record of it — week by week, where your points came from, and what
            to work on next.
          </p>
        </CardContent></Card>
      </div>
    );
  }

  const peak = Math.max(1, ...(r.weekly ?? []).map((w) => w.points));

  return (
    <div className="space-y-4">
      {placedBanner}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {r.season?.name}
            </span>
            <Badge variant="outline" className="text-[10px] font-normal">
              {r.season?.status === "complete" ? "finished" : "running"}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { k: "Points", v: r.totals?.points ?? 0 },
              { k: "Best week", v: r.totals?.best_week ?? 0 },
              { k: "Weeks active", v: `${r.totals?.weeks_active ?? 0}/${r.totals?.weeks_total ?? 0}` },
              { k: "Topics cleared", v: r.ladder?.cleared ?? 0 },
            ].map(({ k, v }) => (
              <div key={k} className="rounded-lg bg-muted/50 p-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{k}</span>
                <div className="font-mono text-xl font-semibold tabular-nums mt-1">{v}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* The curve. A season is a shape, not a total. */}
      {(r.weekly?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Week by week
            </span>
            <div className="mt-4 flex items-end gap-1.5 h-28">
              {r.weekly!.map((w) => (
                <div key={w.week} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
                    {w.points || ""}
                  </span>
                  <div
                    className={`w-full rounded-t ${w.points > 0 ? "bg-primary" : "bg-muted"}`}
                    style={{ height: `${Math.max(3, (w.points / peak) * 84)}px` }}
                  />
                  <span className="font-mono text-[9px] text-muted-foreground">{w.week}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {Object.keys(r.by_activity ?? {}).length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Where your points came from
            </span>
            <div className="mt-3">
              {Object.entries(r.by_activity!)
                .sort(([, a], [, b]) => b - a)
                .map(([k, n]) => (
                  <div key={k} className="flex items-center gap-3 py-2 border-b last:border-b-0">
                    <span className="text-sm flex-1">{ACTIVITY[k] ?? k}</span>
                    <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary"
                           style={{ width: `${(n / (r.totals?.points || 1)) * 100}%` }} />
                    </div>
                    <span className="font-mono text-sm tabular-nums w-10 text-right">{n}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {r.squad && (
        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Your squad
            </span>
            <p className="mt-1 text-lg font-semibold">{r.squad.name}</p>
            <p className="text-sm text-muted-foreground">
              #{r.squad.rank} · {r.squad.points} points · {r.squad.record} ·
              you contributed {r.squad.my_contribution}
            </p>
            {r.podium?.champion && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Trophy className="h-4 w-4 text-amber-500" />
                <span>
                  <b>{r.podium.champion}</b> took the season
                  {r.podium.runner_up && <>, {r.podium.runner_up} second</>}
                  {r.podium.third && <>, {r.podium.third} third</>}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(r.next?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              What to work on
            </span>
            <div className="mt-2">
              {r.next!.map((line, i) => (
                <div key={i} className="flex items-start gap-2.5 py-2.5 border-b last:border-b-0">
                  <ArrowRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm">{line}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Taken from your own record, not a general list.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default StudentSeasonReport;
