import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import LevelDetail from "./LevelDetail";
import { Check, ChevronRight, Loader2, Lock, Play, Search, Star, X } from "lucide-react";

interface Level {
  id: string;
  track_slug: string;
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

interface LevelProgress {
  status: string;
  best_score: number;
  attempts: number;
}

type LevelState = "mastered" | "cleared" | "placed" | "current" | "locked";

const STATE_STYLE: Record<LevelState, { ring: string; line: string }> = {
  mastered: { ring: "border-amber-400 bg-amber-400/15 text-amber-600", line: "bg-amber-400" },
  cleared: { ring: "border-emerald-500 bg-emerald-500/15 text-emerald-600", line: "bg-emerald-500" },
  placed: {
    ring: "border-emerald-500/40 bg-emerald-500/5 text-emerald-600/70",
    line: "bg-emerald-500/40",
  },
  current: {
    ring: "border-primary bg-primary text-primary-foreground animate-level-pulse",
    line: "bg-primary/40",
  },
  locked: {
    ring: "border-muted-foreground/20 bg-muted text-muted-foreground/50",
    line: "bg-muted-foreground/15",
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
  const [levelsByTrack, setLevelsByTrack] = useState<Record<string, Level[]>>({});
  const [progress, setProgress] = useState<Record<string, LevelProgress>>({});
  const [allTracks, setAllTracks] = useState<{ slug: string; name: string; emoji: string }[]>([]);
  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const [search, setSearch] = useState("");

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
      .select("level_id, status, best_score, attempts")
      .eq("student_id", sid);
    setProgress(
      Object.fromEntries(
        (rows ?? []).map((r: any) => [
          r.level_id,
          { status: r.status, best_score: r.best_score, attempts: r.attempts },
        ]),
      ),
    );

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

  // Every track they are on, not just the visible one: the search below has to
  // be able to answer "where do I go if I'm stuck on Git" across all of them.
  useEffect(() => {
    if (tracks.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("levels")
        .select("id, track_slug, level_number, skill, title")
        .in("track_slug", tracks.map((t) => t.track_slug))
        .order("level_number");

      const grouped: Record<string, Level[]> = {};
      for (const level of (data ?? []) as Level[]) {
        (grouped[level.track_slug] ??= []).push(level);
      }
      setLevelsByTrack(grouped);
    })();
  }, [tracks]);

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

  const activeTrack = tracks.find((t) => t.track_slug === activeSlug) ?? tracks[0];
  const levels = useMemo(
    () => (activeTrack ? levelsByTrack[activeTrack.track_slug] ?? [] : []),
    [activeTrack, levelsByTrack],
  );

  const stateOf = useCallback(
    (level: Level, track: TrackSummary): LevelState => {
      const status = progress[level.id]?.status;
      if (status === "mastered") return "mastered";
      if (status === "cleared") return "cleared";
      if (status === "placed") return "placed";
      // Exactly one level is "you are here" — the wall. Anything below it is
      // finished by construction, so a level that somehow sits below the wall
      // without a status is shown as done rather than a second "you are here".
      if (level.level_number === track.unlocked_through) return "current";
      if (level.level_number < track.unlocked_through) return "cleared";
      return "locked";
    },
    [progress],
  );

  /**
   * "I'm confused about Git — where do I go?"
   *
   * Skills repeat across tracks (Python is on five of them) and a student does
   * not think in track names, they think in the thing they are stuck on. This
   * searches every path they are on, so the answer is one box away instead of
   * scrolling twelve maps.
   */
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    return tracks
      .flatMap((track) =>
        (levelsByTrack[track.track_slug] ?? [])
          .filter(
            (l) =>
              l.skill.toLowerCase().includes(query) || l.title.toLowerCase().includes(query),
          )
          .map((level) => ({ level, track })),
      )
      .slice(0, 8);
  }, [search, tracks, levelsByTrack]);

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
  if (tracks.length === 0 || !activeTrack) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pick where you're heading</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose one and we'll lay out the levels from wherever you already are — not from zero.
          </p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {allTracks.map((t, i) => (
            <Button
              key={t.slug}
              variant="outline"
              disabled={placing}
              style={{ animationDelay: `${i * 40}ms` }}
              className="justify-start gap-2 h-auto py-3 animate-level-in"
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

  const doneCount = levels.filter((l) =>
    ["mastered", "cleared", "placed"].includes(progress[l.id]?.status ?? ""),
  ).length;
  const provedCount = levels.filter((l) => progress[l.id]?.status === "mastered").length;
  const assumedCount = levels.filter((l) => progress[l.id]?.status === "placed").length;

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
              className="gap-1.5 transition-transform hover:scale-[1.03]"
            >
              <span>{t.emoji}</span>
              {t.name}
            </Button>
          ))}
        </div>
      )}

      <Card className="animate-pop-in">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="text-xl animate-float-emoji inline-block">{activeTrack.emoji}</span>
            {activeTrack.name}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {doneCount === levels.length && levels.length > 0
              ? "Every level done. Now go prove the ones you skipped."
              : `Level ${Math.min(activeTrack.unlocked_through, levels.length)} of ${levels.length} — on the way to ${activeTrack.role}.`}
          </p>
          <div className="pt-2 space-y-1.5">
            <Progress
              value={levels.length ? (doneCount / levels.length) * 100 : 0}
              className="h-2 transition-all duration-700"
            />
            <p className="text-xs text-muted-foreground">
              {doneCount} of {levels.length} done · {provedCount} proved with real work
            </p>
          </div>

          <div className="relative pt-3">
            <Search className="absolute left-3 top-1/2 mt-1.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Stuck on something? Search it — e.g. Git, SQL, Docker"
              className="pl-9 pr-9 h-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 mt-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {search.trim().length >= 2 && (
            <div className="pt-2 space-y-1 animate-level-in">
              {matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing on your paths teaches that yet.
                </p>
              ) : (
                matches.map(({ level, track }) => {
                  const state = stateOf(level, track);
                  return (
                    <button
                      key={level.id}
                      type="button"
                      disabled={state === "locked"}
                      onClick={() => {
                        setActiveSlug(track.track_slug);
                        setOpenLevel(level.level_number);
                        setSearch("");
                      }}
                      className={`w-full text-left text-sm rounded-md border px-3 py-2 flex items-center gap-2 transition-colors ${
                        state === "locked"
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-muted/60 cursor-pointer"
                      }`}
                    >
                      <span>{track.emoji}</span>
                      <span className="font-medium">{level.skill}</span>
                      <span className="text-muted-foreground truncate">— {level.title}</span>
                      <span className="ml-auto text-xs text-muted-foreground shrink-0">
                        {state === "locked" ? "locked" : `L${level.level_number}`}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </CardHeader>

        <CardContent>
          {assumedCount > 0 && (
            <p className="text-xs text-muted-foreground mb-4 rounded-md bg-muted/50 px-3 py-2">
              {assumedCount} {assumedCount === 1 ? "level is" : "levels are"} ticked because your
              resume said so — we didn't test them. Not sure about one? Open it, read it, take the
              quiz. Passing turns the tick into a real one.
            </p>
          )}

          <div className="relative">
            {levels.map((level, i) => {
              const state = stateOf(level, activeTrack);
              const style = STATE_STYLE[state];
              const clickable = state !== "locked";
              const isLast = i === levels.length - 1;
              const info = progress[level.id];
              const shaky = state === "placed" && (info?.attempts ?? 0) > 0 && (info?.best_score ?? 0) < 2;

              return (
                <div
                  key={level.id}
                  className="flex gap-3 sm:gap-4 animate-level-in"
                  // Staggered so the path draws itself top to bottom. Capped, or a
                  // sixteen-level track would take two seconds to finish appearing.
                  style={{ animationDelay: `${Math.min(i * 45, 500)}ms` }}
                >
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && setOpenLevel(level.level_number)}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-all duration-200 ${style.ring} ${
                        clickable
                          ? "hover:scale-110 active:scale-95 cursor-pointer"
                          : "cursor-not-allowed"
                      }`}
                      aria-label={`Level ${level.level_number}: ${level.title}`}
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
                    {!isLast && <div className={`w-0.5 flex-1 my-1 ${style.line}`} />}
                  </div>

                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && setOpenLevel(level.level_number)}
                    className={`flex-1 text-left pb-6 min-w-0 ${
                      clickable ? "cursor-pointer group" : "cursor-not-allowed"
                    }`}
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
                        <Badge
                          variant="outline"
                          className="h-5 text-emerald-600/80 border-emerald-500/30"
                        >
                          Assumed from your resume
                        </Badge>
                      )}
                      {shaky && (
                        <Badge variant="outline" className="h-5 text-amber-600 border-amber-400/50">
                          Worth a revisit
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
