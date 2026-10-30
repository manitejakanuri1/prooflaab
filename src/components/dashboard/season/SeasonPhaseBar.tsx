import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Where the season is, in one line, for the student and the TPO alike.
 *
 * The season runs in named phases rather than a flat list of weeks, and which
 * phase it is in changes what the squad screens are showing — a league table,
 * an inter-cohort championship, or a final. Without this, "week 8" means
 * nothing to anyone reading it.
 */

export interface SeasonStatus {
  /** One status for every screen (migration 164): a season is running, the last one has finished, or none. */
  state?: "active" | "complete" | "none";
  last_season?: {
    id: string; name: string; completed_at: string | null;
    champion: string | null; runner_up: string | null; third: string | null;
  };
  next_season_name?: string;
  next_season_at?: string;
  season_id?: string;
  name?: string;
  week?: number;
  planned_weeks?: number;
  phase?: string;
  label?: string;
  league_last_week?: number;
  cohorts?: number;
  squads?: number;
  qualified?: number;
  decided?: boolean;
  plan?: { week: number; phase: string; label: string }[];
}

const PHASES: { key: string; short: string }[] = [
  { key: "foundation", short: "Foundation" },
  { key: "league", short: "Cohort league" },
  { key: "championship", short: "Championship" },
  { key: "seeding", short: "Seeding" },
  { key: "knockout", short: "Knockout" },
  { key: "final", short: "Final" },
];

export function useSeasonStatus() {
  const [status, setStatus] = useState<SeasonStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc("my_season_status");
      setStatus((data ?? null) as unknown as SeasonStatus | null);
      setLoading(false);
    })();
  }, []);

  return { status, loading };
}

/** The season this screen should show: the running one, or the one that just finished. */
export const shownSeasonId = (status: SeasonStatus | null) =>
  status?.season_id ?? status?.last_season?.id ?? null;

/** "Season 1 complete - Champion X", the podium, and when the next season opens (MF-008). */
export const SeasonCompleteCard = ({ status }: { status: SeasonStatus | null }) => {
  if (status?.state !== "complete" || !status.last_season) return null;
  const s = status.last_season;
  const opens = status.next_season_at
    ? new Date(status.next_season_at).toLocaleString("en-IN", {
        day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
      })
    : null;
  const podium = [
    { place: "Champion", name: s.champion },
    { place: "Runner-up", name: s.runner_up },
    { place: "Third", name: s.third },
  ].filter((p) => p.name);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {s.name} complete
          </span>
          <span className="font-semibold">
            {s.champion ? `Champion: ${s.champion}` : "No champion - no squad played this season"}
          </span>
        </div>
        {podium.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {podium.map((p) => (
              <div key={p.place} className={cn("rounded-md border px-3 py-2", p.place === "Champion" && "border-primary bg-primary/10")}>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{p.place}</div>
                <div className="font-medium truncate">{p.name}</div>
              </div>
            ))}
          </div>
        )}
        {opens && (
          <p className="mt-3 text-xs text-muted-foreground">
            {status.next_season_name ?? "The next season"} starts on {opens}. Squads stay the same all school year; points start again from 0.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

/** One key for every standings table (MF-009). */
export const StandingsKey = () => (
  <p className="mt-3 text-xs text-muted-foreground">
    W-D-L = won, drawn, lost - league matches only. # is one rank across all sections.
    Same points? The squad with more wins goes higher. Same wins too? The squad that scored more in
    their matches against each other goes higher. A drawn knockout or final goes to the squad that
    finished higher in the table.
  </p>
);

/** Says in plain words why a squad level on points with another sits where it does. */
export const tieNote = (
  list: { id: string; points: number; wins?: number | null }[],
  s: { id: string; points: number; wins?: number | null },
) => {
  const level = list.filter((o) => o.id !== s.id && o.points === s.points);
  if (level.length === 0) return null;
  return level.some((o) => (o.wins ?? 0) !== (s.wins ?? 0))
    ? "Same points - placed by number of wins"
    : "Same points and wins - placed by their matches against each other";
};

const SeasonPhaseBar = ({ status }: { status: SeasonStatus | null }) => {
  if (status?.state === "complete") return <SeasonCompleteCard status={status} />;
  if (!status?.season_id) return null;

  const week = status.week ?? 1;
  const total = status.planned_weeks ?? 12;
  const reached = PHASES.findIndex((p) => p.key === status.phase);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {status.name ?? "Season"}
          </span>
          <span className="font-semibold">
            Week {week} of {total}
          </span>
          <span className="text-sm text-muted-foreground">{status.label}</span>
          {status.decided && (
            <Badge variant="secondary" className="ml-auto">
              {status.qualified} of {status.squads} squads through
            </Badge>
          )}
        </div>

        <div className="mt-3 flex gap-1.5 flex-wrap">
          {PHASES.map((p, i) => (
            <div
              key={p.key}
              className={cn(
                "flex-1 min-w-[92px] rounded-md border px-2 py-1.5 text-center text-[11px]",
                i < reached && "bg-muted text-muted-foreground",
                i === reached && "border-primary bg-primary/10 font-medium",
                i > reached && "text-muted-foreground",
              )}
            >
              {p.short}
            </div>
          ))}
        </div>

        {status.phase === "league" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Each cohort plays its own round robin. The top two of every cohort go
            through after week {status.league_last_week}. Squads that do not go
            through keep their daily work, their scores and every individual
            award — only the championship race ends for them.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default SeasonPhaseBar;
