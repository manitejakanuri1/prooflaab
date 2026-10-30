import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { SeasonStatus } from "./SeasonPhaseBar";

interface YearGroup {
  year_group: number;
  label: string;
  students: number;
  season: { id: string; name: string; week: number; phase: string } | null;
  selected: boolean;
}

/**
 * Migration 184: every year group runs its own season. The college picks which one its screens show,
 * pools sections for one championship if it wants (before the semi-finals), and can ask for fresh squads
 * next season. Every season screen follows the pick, so the page reloads after it.
 */
const YearGroupBar = ({ status, sections }: { status: SeasonStatus | null; sections: string[] }) => {
  const { toast } = useToast();
  const [groups, setGroups] = useState<YearGroup[]>([]);
  const [pool, setPool] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("tpo_year_groups" as never);
    setGroups((data ?? []) as unknown as YearGroup[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPool(status?.cross_sections ?? []); }, [status?.cross_sections]);

  const pick = async (yg: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("tpo_pick_year_group" as never, { _year_group: Number(yg) } as never);
    setBusy(false);
    if (error) { toast({ title: "Could not switch", description: error.message, variant: "destructive" }); return; }
    window.location.reload();
  };

  const save = async (args: Record<string, unknown>, done: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("tpo_season_options" as never, args as never);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: done });
    window.location.reload();
  };

  const selected = groups.find((g) => g.selected);
  const canPool = status?.plan_version === 2 && status.phase === "league" && sections.length >= 2;
  const fresh = !!status?.fresh_squads_next;
  const togglePool = (s: string) =>
    setPool((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  if (groups.length === 0) return null;

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium">Year group</span>
          <Select value={selected ? String(selected.year_group) : undefined} onValueChange={(v) => void pick(v)} disabled={busy}>
            <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.year_group} value={String(g.year_group)}>
                  {g.label} ({g.students})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {selected?.season
              ? `${selected.season.name} - week ${selected.season.week}`
              : "No season running for this year group right now"}
          </span>
        </div>

        {canPool && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground max-w-prose">
              Championship: each section has its own champion. To make one championship across sections,
              tick them below - the best 4 of the ticked sections play the semi-finals and the final.
              You can change this until the semi-finals start (week {(status?.league_last_week ?? 10) + 1}).
            </p>
            <div className="flex flex-wrap gap-3">
              {sections.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={pool.includes(s)} onChange={() => togglePool(s)} />
                  {s}
                </label>
              ))}
              <Button size="sm" variant="outline" disabled={busy || pool.length === 1}
                      onClick={() => void save({ _cross_sections: pool.length ? pool : null, _set_cross: true },
                                               pool.length ? `${pool.join(", ")} play one championship` : "Every section has its own champion")}>
                Save championship
              </Button>
            </div>
          </div>
        )}

        {status?.plan_version === 2 || status?.state === "complete" ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground max-w-prose">
              {fresh
                ? "Next season starts with new squads, dealt again from every student in this year group."
                : "Next season keeps the same squads (points start from 0)."}
            </span>
            <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => void save({ _fresh_squads_next: !fresh },
                                             fresh ? "Next season keeps the same squads" : "Next season starts with new squads")}>
              {fresh ? "Undo - keep the same squads" : "Make fresh squads next season"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default YearGroupBar;
