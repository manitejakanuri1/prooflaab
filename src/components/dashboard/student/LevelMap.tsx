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
import LevelPath, { type LevelState, type PathLevel } from "./LevelPath";
import {
  Check,
  ChevronRight,
  List,
  Loader2,
  Lock,
  Map as MapIcon,
  Play,
  Search,
  Star,
  X,
} from "lucide-react";

/** One ranked track, with the evidence that put it there. */
interface TrackSuggestion {
  slug: string;
  name: string;
  emoji: string;
  role: string | null;
  total_steps: number;
  matched_steps: number;
  match_pct: number;
  matched_skills: string[];
  from_interest: boolean;
  reason: string;
}

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
  evidence: string | null;
}

/** What their resume actually said — the basis for every tick they did not earn. */
interface ResumeSummary {
  target_role: string | null;
  skills: string[];
  projects: number;
  certifications: number;
}

const CONFETTI = ["⭐", "🎉", "✨", "🏅", "💫", "🎊"];

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
  const [suggestions, setSuggestions] = useState<TrackSuggestion[]>([]);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [resume, setResume] = useState<ResumeSummary | null>(null);
  // The board is the point of this screen, but the list carries the resume
  // evidence line under each level, which will not fit on a game node.
  const [view, setView] = useState<"map" | "list">("map");
  const [celebrating, setCelebrating] = useState(false);

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
      .select("level_id, status, best_score, attempts, evidence")
      .eq("student_id", sid);
    setProgress(
      Object.fromEntries(
        (rows ?? []).map((r: any) => [
          r.level_id,
          {
            status: r.status,
            best_score: r.best_score,
            attempts: r.attempts,
            evidence: r.evidence ?? null,
          },
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

      // The ticks they did not earn all trace back to this one row. Showing it
      // in a line means "we assumed you know Git" is checkable at a glance,
      // instead of being an opinion the app formed about them in private.
      const { data: claim } = await supabase
        .from("resume_claims")
        .select("target_role, skills, projects, certifications")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (claim) {
        setResume({
          target_role: claim.target_role,
          skills: (claim.skills as string[] | null) ?? [],
          projects: Array.isArray(claim.projects) ? claim.projects.length : 0,
          certifications: ((claim.certifications as string[] | null) ?? []).length,
        });
      }

      let summaries = await loadProgress(profile.id);

      // Nobody has placed them yet — the assessment does it, but a student who
      // skipped the resume still picked interests, and that is enough to start.
      if (summaries.length === 0) {
        const { data: placed } = await supabase.functions.invoke("levels-place", { body: {} });
        if (placed?.placements?.length) summaries = await loadProgress(profile.id);
      }

      if (summaries.length === 0) {
        // Two suggestions, ranked against what this student has actually
        // claimed and proved, instead of twelve identical buttons. The full
        // list stays available behind a link for anyone changing direction.
        const [{ data: suggested }, { data: everything }] = await Promise.all([
          supabase.rpc("my_suggested_tracks", { _limit: 2 }),
          supabase.from("level_tracks").select("slug, name, emoji").order("sort_order"),
        ]);
        setSuggestions((suggested ?? []) as TrackSuggestion[]);
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
      // A topic can now be several rows (one per sub-step). The map shows one
      // node per topic, so only its entry row (sub_level=1) is fetched here —
      // the steps inside are LevelDetail's job, opened from this one node.
      const { data } = await supabase
        .from("levels")
        .select("id, track_slug, level_number, skill, title")
        .in("track_slug", tracks.map((t) => t.track_slug))
        .eq("sub_level", 1)
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
    // Clearing a level is the one moment on this screen worth a noise. It fires
    // only on a real clear, so it never becomes wallpaper.
    setCelebrating(true);
    window.setTimeout(() => setCelebrating(false), 1600);
  }, [studentId, loadProgress]);

  const activeTrack = tracks.find((t) => t.track_slug === activeSlug) ?? tracks[0];
  const levels = useMemo(
    () => (activeTrack ? levelsByTrack[activeTrack.track_slug] ?? [] : []),
    [activeTrack, levelsByTrack],
  );

  const stateOf = useCallback(
    (level: Level, track: TrackSummary): LevelState => {
      // `level` here is a topic's sub_level=1 row — its own status only
      // reflects step 1, not the whole topic (a topic clears its early steps
      // long before its checkpoint). So "cleared" is read off unlocked_through
      // (which only moves past a topic once every one of its rows is done),
      // not off this row's status directly. 'placed' is still read directly:
      // placement marks every sub-step of a topic together, so step 1's status
      // already speaks for the whole topic in that one case.
      const status = progress[level.id]?.status;
      if (status === "placed") return "placed";
      if (level.level_number === track.unlocked_through) return "current";
      if (level.level_number < track.unlocked_through) return "cleared";
      return "locked";
    },
    [progress],
  );

  /** The same levels, flattened for the game board. */
  const pathLevels: PathLevel[] = useMemo(() => {
    if (!activeTrack) return [];
    return levels.map((level) => {
      const state = stateOf(level, activeTrack);
      const info = progress[level.id];
      return {
        id: level.id,
        level_number: level.level_number,
        skill: level.skill,
        title: level.title,
        state,
        shaky: state === "placed" && (info?.attempts ?? 0) > 0 && (info?.best_score ?? 0) < 2,
      };
    });
  }, [levels, activeTrack, stateOf, progress]);

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
          <CardTitle className="text-lg">
            {suggestions.length > 0 ? "Here's where you already stand" : "Pick where you're heading"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {suggestions.length > 0
              ? "Read from your resume and the skills you picked. Choose one and we'll lay out the levels from wherever you already are — not from zero."
              : "Choose one and we'll lay out the levels from wherever you already are — not from zero."}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Two suggestions, each showing WHY. A student who disagrees can
              still see every track below. */}
          {!showAllTracks &&
            suggestions.map((t, i) => (
              <button
                key={t.slug}
                type="button"
                disabled={placing}
                style={{ animationDelay: `${i * 60}ms` }}
                onClick={() => startTrack(t.slug)}
                className="w-full text-left rounded-lg border-2 p-4 transition-colors animate-level-in hover:border-primary disabled:opacity-60"
              >
                <div className="flex items-start gap-3">
                  <span className="text-3xl leading-none">{t.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-semibold">{t.name}</span>
                      {t.role && <span className="text-xs text-muted-foreground">{t.role}</span>}
                      {t.matched_steps > 0 && (
                        <span className="ml-auto text-xs font-medium text-primary">
                          {t.match_pct}% already covered
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{t.reason}</p>
                    {t.matched_steps > 0 && (
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${t.match_pct}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}

          {(showAllTracks || suggestions.length === 0) && (
            <div className="grid gap-2 sm:grid-cols-2">
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
            </div>
          )}

          {suggestions.length > 0 && allTracks.length > suggestions.length && (
            <button
              type="button"
              onClick={() => setShowAllTracks((v) => !v)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              {showAllTracks ? "Back to what suits you" : `Something else? Show all ${allTracks.length} paths`}
            </button>
          )}
          {placing && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
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
  // stage68: the topic count for "Level X of Y" comes from the highest topic
  // number on this track, not levels.length — the two agree today (levels is
  // already one row per topic), but max(level_number) stays right even if a
  // track ever has a gap in its sub_level=1 rows. doneCount/the progress bar
  // stay on levels.length: they count real rows, not the ladder's top rung.
  const totalLevels = levels.reduce((m, l) => Math.max(m, l.level_number), 0);

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

      <Card className="animate-pop-in overflow-hidden">
        {/* HUD — the one strip that stays true no matter where they scroll. */}
        <div className="flex items-center gap-3 border-b bg-gradient-to-r from-primary/10 via-card to-card px-4 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-xl">
            <span className="animate-float-emoji inline-block">{activeTrack.emoji}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight tracking-tight">
              {activeTrack.name}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              Level {Math.min(activeTrack.unlocked_through, totalLevels)} of {totalLevels} ·{" "}
              {activeTrack.role}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-rung-gold/40 bg-rung-gold/10 px-2.5 py-1">
            <Star className="h-3.5 w-3.5 fill-rung-gold text-rung-gold-deep" />
            <span className="text-xs font-bold tabular-nums text-rung-gold-deep">{provedCount}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-rung-pass/40 bg-rung-pass/10 px-2.5 py-1">
            <Check className="h-3.5 w-3.5 text-rung-pass" strokeWidth={3} />
            <span className="text-xs font-bold tabular-nums text-rung-pass">{doneCount}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 shrink-0 gap-1.5 px-2"
            onClick={() => setView(view === "map" ? "list" : "map")}
          >
            {view === "map" ? <List className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
            <span className="hidden text-xs sm:inline">{view === "map" ? "List" : "Map"}</span>
          </Button>
        </div>

        <CardHeader className="pb-4">
          <p className="text-sm text-muted-foreground">
            {doneCount === levels.length && levels.length > 0
              ? "Every level done. Now go prove the ones you skipped."
              : `Level ${Math.min(activeTrack.unlocked_through, totalLevels)} of ${totalLevels} — on the way to ${activeTrack.role}.`}
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
                <>
                {matches.map(({ level, track }) => {
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
                })}
                </>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent>
          {assumedCount > 0 && (
            <div className="mb-4 rounded-md bg-muted/50 px-3 py-2.5 space-y-1">
              <p className="text-xs font-medium">
                {assumedCount} {assumedCount === 1 ? "level is" : "levels are"} ticked from your
                resume, not from a test.
              </p>
              {resume && (
                <p className="text-xs text-muted-foreground">
                  We read {resume.skills.length} skills
                  {resume.projects > 0 &&
                    ` and ${resume.projects} project${resume.projects === 1 ? "" : "s"}`}
                  {resume.certifications > 0 &&
                    `, ${resume.certifications} certificate${resume.certifications === 1 ? "" : "s"}`}
                  {resume.target_role && ` — aiming at ${resume.target_role}`}. Every tick below says
                  which line earned it.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Not sure about one? Open it and take the quiz — passing makes the tick real.
              </p>
            </div>
          )}

          {view === "map" ? (
            <div className="space-y-2">
              <LevelPath
                // Remount per track, so switching paths re-centres the board on
                // that track's current level instead of keeping the old scroll.
                key={activeTrack.track_slug}
                levels={pathLevels}
                trackEmoji={activeTrack.emoji}
                role={activeTrack.role}
                onOpen={(n) => setOpenLevel(n)}
              />
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" /> you are here
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rung-gold" /> proved
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rung-pass" /> passed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border border-dashed border-rung-pass bg-space-glass" />{" "}
                  from resume
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rung-idle" /> locked
                </span>
              </div>
            </div>
          ) : (
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
                    {state === "placed" && info?.evidence && (
                      <p className="text-xs text-muted-foreground/80 mt-0.5 italic">
                        {info.evidence}
                      </p>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          )}
        </CardContent>
      </Card>

      {celebrating && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center gap-6">
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="animate-confetti-fall text-2xl"
              style={{
                animationDelay: `${i * 55}ms`,
                marginTop: `${(i % 4) * 12}px`,
              }}
            >
              {CONFETTI[i % CONFETTI.length]}
            </span>
          ))}
        </div>
      )}

      {activeSlug && (
        <LevelDetail
          trackSlug={activeSlug}
          levelNumber={openLevel}
          onOpenChange={(open) => !open && setOpenLevel(null)}
          onCleared={refresh}
          onContinue={(nextLevelNumber) => {
            refresh();
            setOpenLevel(nextLevelNumber);
          }}
        />
      )}
    </div>
  );
};

export default LevelMap;
