import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfWeek } from "date-fns";

interface Badge {
  slug: string;
  name: string;
  emoji: string;
  description: string;
  rule_kind: string;
  rule_value: number | null;
}

interface Quest {
  slug: string;
  name: string;
  description: string;
  cadence: string;
  target: number;
  xp_reward: number;
}

/**
 * Badges and quests.
 *
 * Locked badges are shown greyed rather than hidden. A badge you cannot see is
 * not a reason to do anything — the whole point is knowing what is there to
 * earn, and roughly how far off it is.
 */
const StudentAchievements = () => {
  const { profile } = useStudentProfile();
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [earned, setEarned] = useState<Record<string, string>>({});
  const [quests, setQuests] = useState<Quest[]>([]);
  const [progress, setProgress] = useState<Record<string, { progress: number; done: boolean }>>({});

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const today = format(new Date(), "yyyy-MM-dd");
    const monday = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");

    const [badgeRes, earnedRes, questRes, progressRes] = await Promise.all([
      supabase.from("badges").select("*").order("rule_kind").order("rule_value"),
      supabase.from("student_badges").select("badge_slug, awarded_at").eq("student_id", profile.id),
      supabase.from("quests").select("*").eq("is_active", true).order("cadence").order("xp_reward"),
      supabase
        .from("student_quests")
        .select("quest_slug, progress, completed_at, period_start")
        .eq("student_id", profile.id)
        .in("period_start", [today, monday]),
    ]);

    setBadges((badgeRes.data ?? []) as Badge[]);
    setEarned(Object.fromEntries(
      ((earnedRes.data ?? []) as { badge_slug: string; awarded_at: string }[])
        .map((b) => [b.badge_slug, b.awarded_at]),
    ));
    setQuests((questRes.data ?? []) as Quest[]);
    setProgress(Object.fromEntries(
      ((progressRes.data ?? []) as { quest_slug: string; progress: number; completed_at: string | null }[])
        .map((q) => [q.quest_slug, { progress: q.progress, done: Boolean(q.completed_at) }]),
    ));
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;

  const daily = quests.filter((q) => q.cadence === "daily");
  const weekly = quests.filter((q) => q.cadence === "weekly");

  const questRow = (q: Quest) => {
    const p = progress[q.slug] ?? { progress: 0, done: false };
    const pct = Math.min(100, Math.round((p.progress / q.target) * 100));
    return (
      <div key={q.slug} className="py-3 border-b last:border-b-0">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className={`text-sm font-medium ${p.done ? "text-emerald-500" : ""}`}>
            {p.done && "✓ "}{q.name}
          </span>
          <span className="ml-auto font-mono text-xs text-primary">+{q.xp_reward} XP</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{q.description}</p>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${p.done ? "bg-emerald-500" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {p.progress}/{q.target}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-baseline">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Today
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                resets at midnight
              </span>
            </div>
            <div className="mt-1">{daily.map(questRow)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-baseline">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                This week
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                resets Monday
              </span>
            </div>
            <div className="mt-1">{weekly.map(questRow)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-baseline">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Badges
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
              {Object.keys(earned).length} of {badges.length}
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {badges.map((b) => {
              const got = Boolean(earned[b.slug]);
              return (
                <div
                  key={b.slug}
                  className={`flex gap-3 rounded-lg border p-3 ${got ? "border-primary/40 bg-primary/5" : "opacity-55"}`}
                >
                  <span className={`text-2xl leading-none ${got ? "" : "grayscale"}`}>{b.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{b.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{b.description}</p>
                    {got && (
                      <p className="font-mono text-[10px] text-primary mt-1">
                        earned {format(new Date(earned[b.slug]), "d MMM yyyy")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentAchievements;
