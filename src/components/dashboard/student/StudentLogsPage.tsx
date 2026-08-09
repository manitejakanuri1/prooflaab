import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollText, Flame, TriangleAlert, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface TrackLog {
  track_slug: string;
  name: string;
  emoji: string;
  role: string;
  unlocked_through: number;
  total_levels: number;
  done: number;
  weak: { title: string; skill: string; attempts: number; best_score: number }[];
}

// A topic is "weak" the same way LevelMap flags it shaky: placed from a
// resume claim, then genuinely attempted and still scoring low.
const isWeak = (status: string, attempts: number, bestScore: number) =>
  status === "placed" && attempts > 0 && bestScore < 2;

// Rough, not scientific: unfinished topics times the minutes a topic
// realistically takes to read + quiz + build its proof.
const MIN_PER_TOPIC = 45;

const StudentLogsPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<TrackLog[]>([]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: profile } = await supabase
        .from("student_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!profile) {
        setLoading(false);
        return;
      }

      const { data: tracks } = await supabase
        .from("student_tracks")
        .select("track_slug, unlocked_through, is_primary, level_tracks(name, emoji, role)")
        .eq("student_id", profile.id);

      if (!tracks || tracks.length === 0) {
        setLoading(false);
        return;
      }

      const { data: levels } = await supabase
        .from("levels")
        .select("id, track_slug, level_number, skill, title")
        .in("track_slug", tracks.map((t: any) => t.track_slug))
        .eq("sub_level", 1);

      const { data: progress } = await supabase
        .from("student_levels")
        .select("level_id, status, attempts, best_score")
        .eq("student_id", profile.id);

      const progressById = new Map((progress ?? []).map((p: any) => [p.level_id, p]));

      const built: TrackLog[] = tracks.map((t: any) => {
        const trackLevels = (levels ?? []).filter((l: any) => l.track_slug === t.track_slug);
        const done = trackLevels.filter(
          (l: any) => ["mastered", "cleared", "placed"].includes(progressById.get(l.id)?.status ?? ""),
        ).length;
        const weak = trackLevels
          .filter((l: any) => {
            const p = progressById.get(l.id);
            return p && isWeak(p.status, p.attempts ?? 0, p.best_score ?? 0);
          })
          .map((l: any) => {
            const p = progressById.get(l.id);
            return { title: l.title, skill: l.skill, attempts: p.attempts, best_score: p.best_score };
          });

        return {
          track_slug: t.track_slug,
          name: t.level_tracks?.name ?? t.track_slug,
          emoji: t.level_tracks?.emoji ?? "🎯",
          role: t.level_tracks?.role ?? "",
          unlocked_through: t.unlocked_through,
          total_levels: trackLevels.length,
          done,
          weak,
        };
      });

      setLogs(built);
      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="animate-pulse h-32 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  if (logs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            My Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nothing to log yet — start a track on the Roadmap and this fills in.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText className="h-5 w-5" />
        <h1 className="text-lg font-bold">My Logs</h1>
      </div>

      {logs.map((log) => {
        const remaining = Math.max(0, log.total_levels - log.done);
        const hoursNeeded = Math.round((remaining * MIN_PER_TOPIC) / 60 * 10) / 10;
        return (
          <Card key={log.track_slug}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span>{log.emoji}</span>
                {log.name}
                <Badge variant="outline" className="ml-1 font-normal">
                  Level {Math.min(log.unlocked_through, log.total_levels)} of {log.total_levels}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{log.role}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Progress value={log.total_levels ? (log.done / log.total_levels) * 100 : 0} className="h-2" />
                <p className="text-xs text-muted-foreground">{log.done} of {log.total_levels} topics done</p>
              </div>

              {remaining > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>
                    About <span className="font-medium">{hoursNeeded}h</span> of real work left on this path —
                    that is not a track you finish in an afternoon.
                  </span>
                </div>
              )}

              {log.weak.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5 text-amber-600">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    Weak spots — assumed from your resume, then failed when you actually tried
                  </p>
                  {log.weak.map((w) => (
                    <div key={w.title} className="text-xs text-muted-foreground rounded-md border px-2.5 py-1.5">
                      <span className="font-medium text-foreground">{w.skill}</span> — {w.title}
                      {" "}(best {w.best_score}/5 in {w.attempts} {w.attempts === 1 ? "try" : "tries"})
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Flame className="h-3.5 w-3.5 text-orange-500" />
                  No flagged weak spots on this path right now.
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default StudentLogsPage;
