import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import LevelDetail from "./LevelDetail";
import { Check, ChevronRight, Loader2, Lock, Play, Star } from "lucide-react";

interface Level {
  id: string;
  level_number: number;
  skill: string;
  title: string;
}

interface TrackSummary {
  track_slug: string;
  name: string;
  emoji: string;
  role: string;
  placed_at_level: number;
  unlocked_through: number;
  is_primary: boolean;
}

type LevelState = "mastered" | "cleared" | "placed" | "current" | "locked";

const STATE_STYLE: Record<LevelState, { ring: string; dot: string; label: string }> = {
  mastered: {
    ring: "border-amber-400 bg-amber-400/15 text-amber-600",
    dot: "bg-amber-400",
    label: "Proved",
  },
  cleared: {
    ring: "border-emerald-500 bg-emerald-500/15 text-emerald-600",
    dot: "bg-emerald-500",
    label: "Cleared",
  },
  placed: {
    ring: "border-emerald-500/40 bg-emerald-500/5 text-emerald-600/70",
    dot: "bg-emerald-500/40",
    label: "Already knew this",
  },
  current: {
    ring: "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/30",
    dot: "bg-primary",
    label: "You are here",
  },
  locked: {
    ring: "border-muted-foreground/20 bg-muted text-muted-foreground/50",
    dot: "bg-muted-foreground/20",
    label: "Locked",
  },
};

const LevelMap = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [allTracks, setAllTracks] = useState<{ slug: string; name: string; emoji: string }[]>([]);
  const [openLevel, setOpenLevel] = useState<number | null>(null);

  /** Track summaries + which levels are done. Re-run after every clear. */
  const loadProgress = useCallback(async (sid: string) => {
    const { data: myTracks } = await supabase
      .from("student_tracks")
      .select("track_slug, placed_at_level, unlocked_through, is_primary, level_tracks(name, emoji, role)")
      .eq("student_id", sid);

    const summaries: TrackSummary[] = (myTracks ?? []).map((t: any) => ({
      track_slug: t.track_slug,
      name: t.level_tracks?.name ?? t.track_slug,
      emoji: t.level_tracks?.emoji ?? "🎯",
      role: t.level_tracks?.role ?? "",
      placed_at_level: t.placed_at_level,
      unlocked_through: t.unlocked_through,
      is_primary: t.is_primary,
    }));
    summaries.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    setTracks(summaries);

    const { data: rows } = await supabase
      .from("student_levels")
      .select("level_id, status")
      .eq("student_id", sid);
    setProgress(Object.fromEntries((rows ?? []).map((r: any) => [r.level_id, r.status])));

    return summaries;
  }, []);

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
      setStudentId(profile.id);

      let summaries = await loadProgress(profile.id);

      // Nobody has placed them yet — the assessment does it, but a student who
      // skipped the resume still picked interests, and that is enough to start.
      if (summaries.length === 0) {
        const { data: placed } = await supabase.functions.invoke("levels-place", { body: {} });
        if (placed?.placements?.length) summaries = await loadProgress(profile.id);
      }

      if (summaries.length === 0) {
        const { data: everything } = await supabase
          .from("level_tracks")
          .select("slug, name, emoji")
          .order("sort_order");
        setAllTracks((everything ?? []) as any);
      }

      setActiveSlug(summaries[0]?.track_slug ?? null);
      setLoading(false);
    })();
  }, [user, loadProgress]);

  useEffect(() => {
    if (!activeSlug) return;
    (async () => {
      const { data } = await supabase
        .from("levels")
        .select("id, level_number, skill, title")
        .eq("track_slug", activeSlug)
        .order("level_number");
      setLevels((data ?? []) as Level[]);
    })();
  }, [activeSlug]);

  const startTrack = async (slug: string) => {
    setPlacing(true);
    const { error } = await supabase.functions.invoke("levels-place", { body: { track_slug: slug } });
    setPlacing(false);

    if (error) {
      toast({
        title: "Couldn't start that path",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
      return;
    }
    if (studentId) {
      const summaries = await loadProgress(studentId);
      setActiveSlug(slug);
      if (summaries.length > 0) setAllTracks([]);
    }
  };

  const refresh = useCallback(() => {
    if (studentId) loadProgress(studentId);
  }, [studentId, loadProgress]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="animate-pulse h-40 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // No interests on file and no track chosen — ask, rather than guessing a path
  // and quietly putting them on the wrong one.
  if (tracks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pick where you're heading</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose one and we'll lay out the levels from wherever you already are — not from zero.
          </p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {allTracks.map((t) => (
            <Button
              key={t.slug}
              variant="outline"
              disabled={placing}
              className="justify-start gap-2 h-auto py-3"
              onClick={() => startTrack(t.slug)}
            >
              <span className="text-lg">{t.emoji}</span>
              {t.name}
            </Button>
          ))}
          {placing && (
            <p className="text-sm text-muted-foreground flex items-center gap-2 col-span-full">
              <Loader2 className="h-4 w-4 animate-spin" />
              Working out where you start…
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const activeTrack = tracks.find((t) => t.track_slug === activeSlug) ?? tracks[0];

  const stateOf = (level: Level): LevelState => {
    const status = progress[level.id];
    if (status === "mastered") return "mastered";
    if (status === "cleared") return "cleared";
    if (status === "placed") return "placed";
    // Exactly one level is "you are here" — the wall. Anything below it is
    // finished by construction (unlocking only moves past done levels), so a
    // level that somehow sits below the wall without a status is shown as done
    // rather than as a second "you are here".
    if (level.level_number === activeTrack.unlocked_through) return "current";
    if (level.level_number < activeTrack.unlocked_through) return "cleared";
    return "locked";
  };

  const doneCount = levels.filter((l) =>
    ["mastered", "cleared", "placed"].includes(progress[l.id] ?? ""),
  ).length;
  const provedCount = levels.filter((l) => progress[l.id] === "mastered").length;

  return (
    <div className="space-y-4">
      {tracks.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {tracks.map((t) => (
            <Button
              key={t.track_slug}
              size="sm"
              variant={t.track_slug === activeSlug ? "default" : "outline"}
              onClick={() => setActiveSlug(t.track_slug)}
              className="gap-1.5"
            >
              <span>{t.emoji}</span>
              {t.name}
            </Button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="text-xl">{activeTrack.emoji}</span>
            {activeTrack.name}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {doneCount === levels.length
              ? "Every level done. Now go prove the ones you skipped."
              : `Level ${Math.min(activeTrack.unlocked_through, levels.length)} of ${levels.length} — on the way to ${activeTrack.role}.`}
          </p>
          <div className="pt-2 space-y-1.5">
            <Progress value={levels.length ? (doneCount / levels.length) * 100 : 0} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {doneCount} of {levels.length} levels done · {provedCount} proved with real work
            </p>
          </div>
        </CardHeader>

        <CardContent>
          <div className="relative">
            {levels.map((level, i) => {
              const state = stateOf(level);
              const style = STATE_STYLE[state];
              const clickable = state !== "locked";
              const isLast = i === levels.length - 1;

              return (
                <div key={level.id} className="flex gap-3 sm:gap-4">
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && setOpenLevel(level.level_number)}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-transform ${style.ring} ${
                        clickable ? "hover:scale-110 cursor-pointer" : "cursor-not-allowed"
                      }`}
                      aria-label={`Level ${level.level_number}: ${level.title} (${style.label})`}
                    >
                      {state === "mastered" ? (
                        <Star className="h-5 w-5 fill-current" />
                      ) : state === "cleared" || state === "placed" ? (
                        <Check className="h-5 w-5" />
                      ) : state === "locked" ? (
                        <Lock className="h-4 w-4" />
                      ) : (
                        level.level_number
                      )}
                    </button>
                    {!isLast && <div className={`w-0.5 flex-1 my-1 ${style.dot}`} />}
                  </div>

                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && setOpenLevel(level.level_number)}
                    className={`flex-1 text-left pb-6 min-w-0 ${clickable ? "cursor-pointer group" : "cursor-not-allowed"}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <p
                        className={`text-sm font-semibold leading-snug ${
                          state === "locked" ? "text-muted-foreground/60" : "group-hover:underline"
                        }`}
                      >
                        {level.title}
                      </p>
                      {state === "current" && (
                        <Badge className="gap-1 h-5">
                          <Play className="h-3 w-3" />
                          You are here
                        </Badge>
                      )}
                      {state === "placed" && (
                        <Badge variant="outline" className="h-5 text-emerald-600/80 border-emerald-500/30">
                          Already knew this
                        </Badge>
                      )}
                      {state === "mastered" && (
                        <Badge variant="outline" className="h-5 text-amber-600 border-amber-400/50">
                          Proved
                        </Badge>
                      )}
                    </div>
                    <p
                      className={`text-sm mt-0.5 flex items-center gap-1 ${
                        state === "locked" ? "text-muted-foreground/50" : "text-muted-foreground"
                      }`}
                    >
                      {level.skill}
                      {clickable && (
                        <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </p>
                  </button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {activeSlug && (
        <LevelDetail
          trackSlug={activeSlug}
          levelNumber={openLevel}
          onOpenChange={(open) => !open && setOpenLevel(null)}
          onCleared={refresh}
        />
      )}
    </div>
  );
};

export default LevelMap;
