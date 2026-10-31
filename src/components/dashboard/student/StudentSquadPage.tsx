import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SeasonPhaseBar, { StandingsKey, tieNote, useSeasonStatus } from "@/components/dashboard/season/SeasonPhaseBar";
import SeasonLeaderboards from "@/components/dashboard/season/SeasonLeaderboards";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Trophy, Crown, Medal, Award } from "lucide-react";
import { format, startOfWeek, addDays, addMinutes, isWithinInterval } from "date-fns";
import { FAST_WEEK, FAST_WEEK_MINUTES, WHEN_FORMAT } from "@/lib/testClock";
import StudentSeasonReport from "./StudentSeasonReport";
import SquadSwapCard from "./SquadSwapCard";
import { fmtMark } from "@/lib/lotMarks";

/** Why a student has no squad yet (migration 195: 5 waiting students of a section make a new squad). */
function ReserveReason() {
  const [r, setR] = useState<{ section: string; waiting: number; needed: number } | null>(null);
  useEffect(() => {
    supabase.rpc("my_reserve_status" as never).then(({ data }) => setR((data as typeof r) ?? null), () => {});
  }, []);
  if (!r) return null;
  return (
    <p className="text-sm max-w-prose">
      {r.waiting >= r.needed
        ? `You join a squad of section ${r.section} when the next season starts.`
        : `All squads in your section (${r.section}) are full. You join a new squad when ${r.needed} students are waiting (${r.waiting} so far). Your college can also place you in a squad.`}
    </p>
  );
}

/** squad_marks_week() (migration 165): each member's Daily Lot marks this week, and the squad total. */
interface SquadWeekMarks {
  squad_total: number;
  members: { student_id: string; full_name: string; week_total: number; lots: number; is_me: boolean }[];
}

interface Squad {
  id: string;
  name: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  rank: number | null;
  previous_rank: number | null;
  max_members: number;
  cohort: string | null;
  season_id: string | null;
  /** Null while the league is still running. */
  qualified: boolean | null;
  /** Migration 184: the section (or pooled sections) this squad plays its championship in. */
  bracket?: string | null;
  seed: number | null;
}

interface Member {
  student_id: string;
  role: string | null;
  contribution: number;
  student_profiles: { full_name: string; total_xp: number } | null;
}

interface Achievement {
  kind: "win" | "week" | "milestone" | "badge" | "championship";
  title: string;
  detail: string | null;
  achieved_at: string | null;
}

interface Match {
  id: string;
  scheduled_at: string;
  status: string;
  home_points: number | null;
  away_points: number | null;
  home_squad: string;
  away_squad: string;
  /** Saved by settle_round (migration 163). */
  winner_squad?: string | null;
  decided_by?: string | null;
}

const ACHIEVEMENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  win: Trophy,
  week: Crown,
  milestone: Medal,
  badge: Award,
};

/**
 * Squad — one destination, five views.
 *
 * The design deck says this twice: Overview, Members, Matches and Standings are
 * tabs inside Squad, not four sidebar entries. A student asks "how is my team
 * doing" once, and gets one page.
 */
const StudentSquadPage = () => {
  const { profile } = useStudentProfile();
  const [loading, setLoading] = useState(true);
  const [squad, setSquad] = useState<Squad | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [standings, setStandings] = useState<Squad[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const { status: season } = useSeasonStatus();
  // my_season_status answers nothing once a season is over, so read the squad's own season row.
  const [ended, setEnded] = useState<{ champion: string | null; champions: { bracket: string; champion: string }[] } | null>(null);
  const [weekMarks, setWeekMarks] = useState<SquadWeekMarks | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;

    const { data: membership } = await supabase
      .from("squad_members")
      .select("squad_id")
      .eq("student_id", profile.id)
      .is("left_at", null)   // a student who moved squads also has their old, closed membership rows
      .maybeSingle();

    if (!membership) { setLoading(false); return; }

    const [squadRes, memberRes, matchRes, standingRes, achieveRes] = await Promise.all([
      supabase.from("squads").select("*").eq("id", membership.squad_id).maybeSingle(),
      // my_squad_members(): names of this student's own squad, in joined order
      // (not contribution order - a squad is cooperative, not a leaderboard).
      // A direct read cannot show names: student_profiles is owner-only.
      supabase.rpc("my_squad_members" as never),
      supabase
        .from("squad_matches")
        .select("*")
        .or(`home_squad.eq.${membership.squad_id},away_squad.eq.${membership.squad_id}`)
        .order("scheduled_at", { ascending: false })
        .limit(10),
      // The league this squad actually plays in, which is its cohort's, not
      // the whole college's. A table full of sections you never meet is not a
      // standing.
      supabase.from("squads").select("*").order("points", { ascending: false }).limit(60),
      // Wins, weeks at the top, milestones and badges — every one of them read
      // back out of the match and weekly-score records rather than stored a
      // second time where it could drift from them.
      supabase.rpc("my_squad_achievements" as never),
    ]);
    const { data: wm } = await supabase.rpc("squad_marks_week" as never, { _squad_id: membership.squad_id } as never);
    setWeekMarks((wm as unknown as SquadWeekMarks | null) ?? null);

    const mySquad = squadRes.data as Squad | null;
    const allSquads = (standingRes.data ?? []) as Squad[];
    // MF-009: this season only, every section, ordered by the one overall rank (recount_season).
    const league = mySquad
      ? allSquads.filter((s) => s.season_id === mySquad.season_id)
          .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.points - a.points)
      : [];

    setSquad(mySquad);
    setMembers(((memberRes.data ?? []) as unknown as (Member & { full_name: string; total_xp: number })[])
      .map((m) => ({ ...m, student_profiles: { full_name: m.full_name, total_xp: m.total_xp } })));
    setMatches((matchRes.data ?? []) as Match[]);
    setStandings(league);
    // Names still come from every squad read, because a championship fixture
    // pairs this squad with one from another cohort.
    setNames(Object.fromEntries(allSquads.map((s) => [s.id, s.name])));
    setAchievements((achieveRes.data ?? []) as unknown as Achievement[]);
    if (mySquad?.season_id) {
      const { data: s } = await supabase.from("seasons")
        .select("status, champion_squad_id").eq("id", mySquad.season_id).maybeSingle();
      const champ = s?.champion_squad_id ? (allSquads.find((q) => q.id === s.champion_squad_id)?.name ?? null) : null;
      // 184: a champion in every section
      const { data: champs } = s?.status === "complete"
        ? await supabase.from("season_champions" as never).select("bracket, champion_squad_id").eq("season_id", mySquad.season_id)
        : { data: null };
      const champions = ((champs ?? []) as unknown as { bracket: string; champion_squad_id: string }[])
        .map((c) => ({ bracket: c.bracket, champion: allSquads.find((q) => q.id === c.champion_squad_id)?.name ?? "" }));
      setEnded(s?.status === "complete" ? { champion: champ, champions } : null);
    }
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { void load(); }, [load]);
  // MF-051: points and matches move during the day; refresh while the page is open (paused in a hidden tab).
  useLiveRefresh(load, 30_000);

  if (loading) return <Skeleton className="h-72 w-full rounded-xl" />;

  if (!squad) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" /> Squad
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SeasonPhaseBar status={season?.state === "complete" ? season : null} />
          <ReserveReason />
          <p className="text-sm text-muted-foreground max-w-prose">
            Once you are placed in a squad, this is where you will see your team's rank and points,
            who is active, your upcoming matches and the full standings.
          </p>
          <div className="grid gap-2 sm:grid-cols-5">
            {["Overview", "Members", "Matches", "Standings", "Achievements"].map((v) => (
              <div key={v} className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                {v}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const mine = members.find((m) => m.student_id === profile?.id);
  const totalPoints = members.reduce((sum, m) => sum + m.contribution, 0);
  const myShare = totalPoints > 0 && mine ? Math.round((mine.contribution / totalPoints) * 100) : 0;
  const movement = squad.previous_rank != null && squad.rank != null ? squad.previous_rank - squad.rank : 0;
  const next = matches.find((m) => m.status === "scheduled");
  const sectionRank = standings.findIndex((s) => s.id === squad.id) + 1;

  // With an odd number of squads one sits out each round. Their tab used to
  // show nothing at all, which reads as a broken screen rather than a rest.
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const thisWeek = FAST_WEEK
    ? { start: addMinutes(new Date(), -FAST_WEEK_MINUTES), end: addMinutes(new Date(), FAST_WEEK_MINUTES) }
    : { start: weekStart, end: addDays(weekStart, 7) };
  const restWeek = !matches.some((m) =>
    isWithinInterval(new Date(m.scheduled_at), thisWeek));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold tracking-tight">
          THE <span className="text-primary">LAB</span>
        </h1>
        <span className="ml-auto font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {/* The Standings tab ranks the squad inside its section; squads.rank is college-wide. */}
          {squad.rank
            ? `${sectionRank ? `#${sectionRank} in ${squad.cohort ?? "section"} · ` : ""}#${squad.rank} in college`
            : "Unranked"}
        </span>
      </div>

      <SeasonPhaseBar status={season} />

      <Card>
        <CardContent className="pt-5">
          <h2 className="text-xl font-semibold">{squad.name}</h2>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
            {squad.cohort ? `${squad.cohort} · ` : ""}{members.length} of {squad.max_members} members
          </p>
          {ended ? (
            <p className="mt-2 text-sm" data-testid="season-over">
              <span className="font-medium">Season over.</span>{" "}
              <span className="text-muted-foreground">
                {ended.champions.length > 0
                  ? ended.champions.map((c) => `${c.bracket} Champion: ${c.champion}. `).join("")
                  : ended.champion ? `Champion: ${ended.champion}. ` : ""}
                {squad.rank ? `${squad.name} finished #${squad.rank} in the college.` : ""}
              </span>
            </p>
          ) : squad.qualified !== null && (
            <p className="mt-2 text-sm">
              {squad.qualified ? (
                <span className="text-verified font-medium">
                  Through to the {squad.bracket ? `${squad.bracket} ` : ""}championship{squad.seed ? ` as seed ${squad.seed}` : ""}.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  The championship race is over for this squad. Your daily work,
                  your score and every individual award carry on to the end of
                  the season exactly as before.
                </span>
              )}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { k: "Points", v: squad.points },
              { k: "Record", v: `${squad.wins}–${squad.draws ?? 0}–${squad.losses}` },
              { k: "My share", v: `${myShare}%` },
              { k: "Movement", v: movement === 0 ? "—" : movement > 0 ? `▲${movement}` : `▼${-movement}` },
            ].map(({ k, v }) => (
              <div key={k} className="rounded-lg bg-muted/50 p-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{k}</span>
                <div className="font-mono text-xl font-semibold tabular-nums mt-1">{v}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <SquadSwapCard onSwapped={() => void load()} />

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="achievements">Achievements</TabsTrigger>
          <TabsTrigger value="leaderboards">Leaderboards</TabsTrigger>
          <TabsTrigger value="season">Season</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card>
            <CardContent className="pt-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Next match
              </span>
              {ended && (
                <p className="text-sm mt-2 text-muted-foreground">The season is over. No more matches.</p>
              )}
              {!ended && restWeek && (
                <p className="text-sm mt-2">
                  <span className="font-medium">Rest round.</span>{" "}
                  <span className="text-muted-foreground">
                    Your squad has no fixture this week — every point you earn still counts
                    toward the table.
                  </span>
                </p>
              )}
              {next ? (
                <div className="mt-2">
                  <p className="font-semibold">
                    {names[next.home_squad] ?? "?"} <span className="text-muted-foreground font-normal">vs</span>{" "}
                    {names[next.away_squad] ?? "?"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {format(new Date(next.scheduled_at), "EEEE d MMM, h:mm a")}
                  </p>
                </div>
              ) : !restWeek && !ended ? (
                <p className="text-sm text-muted-foreground mt-2">Nothing scheduled yet.</p>
              ) : null}
            </CardContent>
          </Card>

          {weekMarks && (
            <Card data-testid="squad-week-marks">
              <CardContent className="pt-5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    This week&apos;s marks
                  </span>
                  <span className="text-sm">
                    Squad total <span className="font-mono font-bold">{fmtMark(weekMarks.squad_total)}</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each Daily Lot: coding mark + voice mark, out of 20. A missed day only costs that member.
                </p>
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      <th className="pb-2 pr-3">#</th>
                      <th className="pb-2 pr-3">Member</th>
                      <th className="pb-2 pr-3">Lots</th>
                      <th className="pb-2">Week total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekMarks.members.map((m, i) => (
                      <tr key={m.student_id} className={`border-t ${m.is_me ? "bg-primary/5" : ""}`}>
                        <td className="py-2 pr-3 font-mono tabular-nums">{i + 1}</td>
                        <td className="py-2 pr-3">
                          {m.full_name}
                          {m.is_me && <span className="ml-2 font-mono text-[10px] text-muted-foreground">you</span>}
                        </td>
                        <td className="py-2 pr-3 font-mono tabular-nums">{m.lots}</td>
                        <td className="py-2 font-mono tabular-nums">{fmtMark(m.week_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Squad pulse
              </span>
              <p className="text-sm mt-2">
                {members.filter((m) => m.contribution > 0).length} of {members.length} members have
                contributed.
                {/* MF-059: no nudging once the season is over. */}
                {!ended && ` ${members.filter((m) => m.contribution === 0).length} need a nudge.`}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <Card>
            <CardContent className="pt-5 overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="pb-2 pr-3">Member</th>
                    <th className="pb-2 pr-3">Role</th>
                    <th className="pb-2">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr
                      key={m.student_id}
                      className={`border-t ${m.student_id === profile?.id ? "bg-primary/5" : ""}`}
                    >
                      <td className="py-2.5 pr-3">
                        {m.student_profiles?.full_name ?? "—"}
                        {m.student_id === profile?.id && (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">you</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{m.role === "captain" ? "Captain" : "Member"}</td>
                      <td className="py-2.5 font-mono tabular-nums">{m.contribution}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="matches" className="mt-4">
          <Card>
            <CardContent className="pt-5 overflow-x-auto">
              {matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matches yet.</p>
              ) : (
                <table className="w-full text-sm min-w-[400px]">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      <th className="pb-2 pr-3">Match</th>
                      <th className="pb-2 pr-3">When</th>
                      <th className="pb-2">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m) => {
                      const home = m.home_squad === squad.id;
                      const us = home ? m.home_points : m.away_points;
                      const them = home ? m.away_points : m.home_points;
                      const won = us != null && them != null && us > them;
                      const drew = us != null && them != null && us === them;
                      return (
                        <tr key={m.id} className="border-t">
                          <td className="py-2.5 pr-3">
                            vs {names[home ? m.away_squad : m.home_squad] ?? "?"}
                          </td>
                          <td className="py-2.5 pr-3 text-muted-foreground">
                            {format(new Date(m.scheduled_at), WHEN_FORMAT)}
                          </td>
                          <td className="py-2.5 font-mono text-xs">
                            {m.status === "no_activity" ? (
                              // MF-003: nobody on either side finished a Lot (task + voice) that week.
                              <span className="text-muted-foreground">No activity yet</span>
                            ) : m.status === "played" && us != null ? (
                              <span className={drew && !m.winner_squad ? "text-muted-foreground" : (m.winner_squad ? m.winner_squad === squad.id : won) ? "text-verified" : "text-alert"}>
                                {drew ? "Drew" : won ? "Won" : "Lost"} {us}–{them}
                                {drew && m.decided_by === "higher_seed" && m.winner_squad
                                  ? (m.winner_squad === squad.id ? " – went through: finished higher in the table" : " – out: the other squad finished higher in the table")
                                  : ""}
                              </span>
                            ) : (
                              <span className="text-primary">{m.status}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="standings" className="mt-4">
          <Card>
            <CardContent className="pt-5 overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="pb-2 pr-3">#</th>
                    <th className="pb-2 pr-3">Squad</th>
                    <th className="pb-2 pr-3">Section</th>
                    <th className="pb-2 pr-3">Points</th>
                    <th className="pb-2 pr-3">W</th>
                    <th className="pb-2 pr-3">D</th>
                    <th className="pb-2">L</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => (
                    <tr key={s.id} className={`border-t ${s.id === squad.id ? "bg-primary/5" : ""}`}>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{s.rank ?? i + 1}</td>
                      <td className="py-2.5 pr-3">
                        {s.name}
                        {s.id === squad.id && (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">you</span>
                        )}
                        {tieNote(standings, s) && (
                          <span className="block text-[11px] text-muted-foreground">{tieNote(standings, s)}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{s.cohort ?? "—"}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{s.points}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{s.wins}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{s.draws ?? 0}</td>
                      <td className="py-2.5 font-mono tabular-nums">{s.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <StandingsKey />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="achievements" className="mt-4">
          <Card>
            <CardContent className="pt-5">
              {achievements.length === 0 ? (
                <p className="text-sm text-muted-foreground max-w-prose">
                  Nothing yet. Wins, weeks at the top of the table, point milestones and your own
                  badges land here as they happen — none of it is entered by hand.
                </p>
              ) : (
                <div>
                  {achievements.map((a, i) => {
                    const Icon = ACHIEVEMENT_ICON[a.kind] ?? Award;
                    return (
                      <div key={`${a.kind}-${i}`} className="flex items-start gap-3 py-3 border-b last:border-b-0">
                        <Icon className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{a.title}</p>
                          {a.detail && (
                            <p className="text-xs text-muted-foreground mt-0.5">{a.detail}</p>
                          )}
                        </div>
                        {a.achieved_at && (
                          <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap mt-1">
                            {format(new Date(a.achieved_at), "d MMM yyyy")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="leaderboards" className="mt-4">
          <SeasonLeaderboards highlightStudentId={profile?.id} />
        </TabsContent>

        <TabsContent value="season" className="mt-4">
          <StudentSeasonReport />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default StudentSquadPage;
