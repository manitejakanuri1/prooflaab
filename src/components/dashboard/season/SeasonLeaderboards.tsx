import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useSeasonStatus } from "./SeasonPhaseBar";

/**
 * The scoreboard that never ends.
 *
 * A squad's championship can finish in week 6; a student's season cannot. These
 * six tables and seven awards are computed from every week a student played,
 * with no reference at all to whether their squad qualified — which is why a
 * student from a knocked-out squad can sit at the top of them.
 */

interface Row {
  place: number;
  student_id: string;
  full_name: string;
  squad_name: string | null;
  cohort: string | null;
  value: number;
  detail: string;
}

interface Award {
  award: string;
  title: string;
  student_id: string;
  full_name: string;
  squad_name: string | null;
  value: number;
  detail: string;
}

const BOARDS = [
  { key: "overall", label: "Overall", unit: "points" },
  { key: "weekly", label: "This week", unit: "points" },
  { key: "growth", label: "Growth", unit: "points/week" },
  { key: "consistency", label: "Consistency", unit: "weeks" },
  { key: "participation", label: "Participation", unit: "weeks" },
  { key: "skill", label: "Skill", unit: "score" },
];

// Every award the season gives. One nobody qualified for (no points, migration 162) shows "Not awarded".
const AWARDS = [
  { award: "orange_cap", title: "Orange Cap" },
  { award: "purple_cap", title: "Purple Cap" },
  { award: "player_of_the_week", title: "Player of the Week" },
  { award: "most_improved", title: "Most Improved" },
  { award: "consistency", title: "Consistency Award" },
  { award: "squad_mvp", title: "Squad MVP" },
  { award: "rising_star", title: "Rising Star" },
];

const SeasonLeaderboards = ({ highlightStudentId }: { highlightStudentId?: string }) => {
  const [kind, setKind] = useState("overall");
  const [rows, setRows] = useState<Row[]>([]);
  const { status } = useSeasonStatus();
  const [awards, setAwards] = useState<Award[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { data } = await supabase.rpc("season_leaderboard", { _kind: kind, _limit: 25 });
      setRows((data ?? []) as unknown as Row[]);
      setLoading(false);
    })();
  }, [kind]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc("season_awards");
      setAwards((data ?? []) as unknown as Award[]);
    })();
  }, []);

  const unit = BOARDS.find((b) => b.key === kind)?.unit ?? "";

  return (
    <div className="space-y-4">
      {status && (
        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Individual recognition
            </span>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {AWARDS.map(({ award, title }) => {
                const a = awards.find((x) => x.award === award);
                return (
                  <div
                    key={award}
                    className={cn(
                      "rounded-lg border px-3 py-2",
                      a && a.student_id === highlightStudentId && "border-primary bg-primary/5",
                    )}
                  >
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {title}
                    </div>
                    {a ? (
                      <>
                        <div className="font-medium truncate">{a.full_name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {a.squad_name ?? "no squad"} · {a.detail}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">Not awarded</div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-5">
          <Tabs value={kind} onValueChange={setKind}>
            <TabsList className="flex-wrap h-auto">
              {BOARDS.map((b) => (
                <TabsTrigger key={b.key} value={b.key}>{b.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <p className="mt-3 text-xs text-muted-foreground">
            {/* After a season ends the table is the last season's final one (migration 124). */}
            {status && !status.season_id && rows.length > 0
              ? "Final table of your college's last season. A new one starts with the next season."
              : "Every student is on this table for the whole season, whatever happened to their squad in the championship."}
          </p>

          <div className="mt-3 overflow-x-auto">
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing scored yet this season.
              </p>
            ) : (
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="pb-2 pr-3">#</th>
                    <th className="pb-2 pr-3">Student</th>
                    <th className="pb-2 pr-3">Squad</th>
                    <th className="pb-2 pr-3">Cohort</th>
                    <th className="pb-2">{unit}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.student_id}
                      className={cn(
                        "border-t",
                        r.student_id === highlightStudentId && "bg-primary/5",
                      )}
                    >
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{r.place}</td>
                      <td className="py-2.5 pr-3 font-medium">
                        {r.full_name}
                        {r.student_id === highlightStudentId && (
                          <Badge variant="secondary" className="ml-2">You</Badge>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{r.squad_name ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{r.cohort ?? "—"}</td>
                      <td className="py-2.5 font-mono tabular-nums font-semibold">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SeasonLeaderboards;
