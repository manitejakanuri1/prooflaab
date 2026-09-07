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

const SeasonPhaseBar = ({ status }: { status: SeasonStatus | null }) => {
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
