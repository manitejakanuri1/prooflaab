import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SeasonPhaseBar, { useSeasonStatus } from "@/components/dashboard/season/SeasonPhaseBar";
import SeasonLeaderboards from "@/components/dashboard/season/SeasonLeaderboards";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { format } from "date-fns";
import TpoStudentProfile from "./TpoStudentProfile";
import { ChevronRight, Lock, Unlock, Archive, ArchiveRestore, Shuffle, Swords, TrendingUp, TrendingDown, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Squad {
  id: string; name: string; points: number; wins: number; draws: number; losses: number;
  rank: number | null; max_members: number;
  is_locked: boolean; archived_at: string | null;
  cohort: string | null;
  /** Null until the league ends, then true or false for the rest of the season. */
  qualified: boolean | null;
  seed: number | null;
}
interface Performance {
  squad_id: string; squad_name: string; week: number; points: number;
  active_members: number; total_members: number; rank: number | null;
  change: number | null; participation: number;
}
interface Achievement {
  squad_id: string; squad_name: string; wins: number; draws: number; losses: number;
  weeks_led: number; best_rank: number | null; best_week_points: number | null;
  member_badges: number; is_locked: boolean; archived: boolean;
}
interface Member {
  student_id: string; squad_id: string; contribution: number; membership_type: string;
  student_profiles: { full_name: string; roll_number: string | null; last_active: string | null } | null;
}
interface Match {
  id: string; scheduled_at: string; status: string;
  home_squad: string; away_squad: string;
  home_points: number | null; away_points: number | null;
  stage: string; cohort: string | null; round_number: number | null;
}
interface StudentRow {
  student_id: string; full_name: string; roll_number: string | null; is_reserve: boolean;
}
/** A student with no squad. The cohort matters: it says which league they belong in. */
interface Reserve {
  student_id: string; full_name: string; roll_number: string | null;
  cohort: string | null; total_xp: number;
}
interface ScoringRule {
  metric: string; label: string; description: string | null;
  points: number; default_points: number; customized: boolean;
}
interface NamingTheme {
  branch: string; theme: string; default_theme: string; customized: boolean;
}

const daysSince = (iso: string | null) =>
  iso == null ? 999 : Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/**
 * Squads — the destination the college dashboard never had.
 *
 * Students could already see their own squad, its standings and its next match.
 * The college that formed those squads could see none of it, and had no way to
 * move a reserve student into a team. Everything here reads tables that have
 * existed since the rebuild; only Assign needs a function, because putting a
 * student in a squad has to close their old membership, respect capacity and
 * write an audit record all at once or not at all.
 */
interface Props {
  /** A squad chosen elsewhere — from Home's standings, or a student's profile. */
  focusSquad?: string | null;
  /** Bumped on every navigation, so choosing the same squad twice still works. */
  focusKey?: number;
}

const TpoSquads = ({ focusSquad, focusKey }: Props) => {
  const { toast } = useToast();
  const [squads, setSquads] = useState<Squad[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickStudent, setPickStudent] = useState("");
  const [pickSquad, setPickSquad] = useState("");
  const [when, setWhen] = useState("now");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("standings");
  const [openStudent, setOpenStudent] = useState<string | null>(null);
  const [performance, setPerformance] = useState<Performance[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  // Keyed by squad, not one box for all of them: with a single string, typing
  // into one squad's name field and pressing Save on another renamed the wrong
  // squad.
  const [rename, setRename] = useState<Record<string, string>>({});
  const [capacity, setCapacity] = useState<Record<string, string>>({});
  const [scoringRules, setScoringRules] = useState<ScoringRule[]>([]);
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({});
  const [savingWeight, setSavingWeight] = useState<string | null>(null);
  const [namingThemes, setNamingThemes] = useState<NamingTheme[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [newSquadName, setNewSquadName] = useState("");
  const [newSquadCohort, setNewSquadCohort] = useState("");
  const [themeDraft, setThemeDraft] = useState<Record<string, string>>({});
  const [savingTheme, setSavingTheme] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cid = await supabase.rpc("my_college_id" as never);
    const collegeId = cid.data as unknown as string | null;
    if (!collegeId) { setSquads([]); return; }

    // Squads first, because everything below is scoped by which squads are
    // this college's. squad_matches and squad_members are both readable by any
    // signed-in user, so reading them unfiltered would put another college's
    // fixtures and members in these tables — nothing secret, still wrong.
    const { data: sqData } = await supabase
      .from("squads").select("*").eq("college_id", collegeId)
      // Cohort first: the league table a TPO reads is their section's table,
      // and one long list of every section mixed together is not that.
      .order("cohort", { ascending: true, nullsFirst: false })
      .order("points", { ascending: false });

    const list = (sqData ?? []) as unknown as Squad[];
    setSquads(list);

    if (list.length === 0) { setMembers([]); setMatches([]); return; }
    const ids = list.map((s) => s.id);

    const [mem, mat, stu, perf, ach, rules, themes, res] = await Promise.all([
      supabase.from("squad_members")
        .select("student_id, squad_id, contribution, membership_type, student_profiles(full_name, roll_number, last_active)")
        .in("squad_id", ids)
        .is("left_at", null),
      supabase.from("squad_matches").select("*")
        .or(`home_squad.in.(${ids.join(",")}),away_squad.in.(${ids.join(",")})`)
        .order("scheduled_at", { ascending: false }).limit(20),
      supabase.rpc("tpo_students" as never),
      supabase.rpc("tpo_squad_performance" as never, { _weeks: 8 } as never),
      supabase.rpc("tpo_squad_achievements" as never),
      supabase.rpc("tpo_scoring_rules" as never),
      supabase.rpc("tpo_naming_themes" as never),
      supabase.rpc("tpo_reserves"),
    ]);

    setMembers((mem.data ?? []) as unknown as Member[]);
    setMatches((mat.data ?? []) as unknown as Match[]);
    setStudents((stu.data ?? []) as unknown as StudentRow[]);
    setPerformance((perf.data ?? []) as unknown as Performance[]);
    setAchievements((ach.data ?? []) as unknown as Achievement[]);
    setScoringRules((rules.data ?? []) as unknown as ScoringRule[]);
    setNamingThemes((themes.data ?? []) as unknown as NamingTheme[]);
    setReserves((res.data ?? []) as unknown as Reserve[]);
    if (list.length && !selected) setSelected(list[0].id);
  }, [selected]);

  useEffect(() => { void load(); }, [load]);

  // Arriving with a squad already chosen means somebody clicked its name, and
  // what they wanted to see is who is in it.
  useEffect(() => {
    if (focusSquad) { setSelected(focusSquad); setTab("members"); }
    else { setTab("standings"); }
  }, [focusSquad, focusKey]);

  const { status: season } = useSeasonStatus();

  const names = useMemo(
    () => Object.fromEntries((squads ?? []).map((s) => [s.id, s.name])), [squads]);
  const current = (squads ?? []).find((s) => s.id === selected) ?? null;
  const currentMembers = members.filter((m) => m.squad_id === selected);


  const assign = async () => {
    if (!pickStudent || !pickSquad) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("assign_to_squad" as never, {
      _student_id: pickStudent,
      _squad_id: pickSquad,
      // "Next Monday" is a real option in the spec: a squad change mid-week
      // scrambles a running fixture, so an officer can line it up for the break.
      _effective: when === "monday" ? nextMonday() : null,
    } as never);
    setBusy(false);
    if (error) {
      toast({ title: "Not assigned", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as unknown as { student: string; squad: string; members_now: number; max_members: number };
    toast({
      title: `${r.student} joined ${r.squad}`,
      description: `${r.members_now} of ${r.max_members} members. The change is in the audit log.`,
    });
    setPickStudent("");
    void load();
  };

  /**
   * §14, steps one to six. Every member's week is scored from what they
   * actually did, summed into a squad score, ranked, published, and this
   * round's fixture settled from the two squads' totals.
   */
  const runWeek = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("tpo_run_week" as never, {} as never);
    setBusy(false);
    if (error) {
      toast({ title: "Could not score the week", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as unknown as { week: number; squads_scored: number; matches_settled: number };
    toast({
      title: `Week ${r.week} scored`,
      description: `${r.squads_scored} squads ranked, ${r.matches_settled} match${
        r.matches_settled === 1 ? "" : "es"} settled.`,
    });
    void load();
  };

  const fixtures = async (force = false) => {
    setBusy(true);
    const { data, error } = await supabase.rpc(
      "tpo_generate_fixtures" as never, { _force: force } as never);
    setBusy(false);
    if (error) {
      // The refusal when results already exist is the useful case: it says how
      // many would be thrown away, and asks rather than deciding.
      toast({
        title: "Match schedule not changed",
        description: error.message,
        variant: "destructive",
        action: !force ? (
          <ToastAction altText="Rebuild anyway" onClick={() => void fixtures(true)}>
            Rebuild anyway
          </ToastAction>
        ) : undefined,
      });
      return;
    }
    const r = data as unknown as { fixtures: number; weeks_covered: number; cycles: number };
    toast({
      title: `${r.fixtures} matches scheduled`,
      description: `Every squad plays every other squad, repeated ${r.cycles} time${
        r.cycles === 1 ? "" : "s"} to cover all ${r.weeks_covered} weeks of the season.`,
    });
    void load();
  };

  /**
   * Manage, from §10: create, rename, lock, rebalance or archive. Every one of
   * them goes through the same function, which checks the squad belongs to this
   * college and writes an audit record — so a rename is as accountable as a
   * reassignment.
   */
  const manage = async (
    squadId: string,
    patch: { _name?: string; _max_members?: number; _is_locked?: boolean; _archived?: boolean },
    said: string,
  ) => {
    setBusy(true);
    const { error } = await supabase.rpc("tpo_squad_update" as never, {
      _squad_id: squadId, ...patch,
    } as never);
    setBusy(false);
    if (error) {
      toast({ title: "Not changed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: said });
    void load();
  };

  /**
   * Draws the squads themselves, which nothing in the app used to do — the
   * function existed and was granted, and no button ever called it. Forming is
   * the step before rebalancing: rebalance fills squads that exist, so on a
   * college with none it has nowhere to put anybody and reports moving zero.
   */
  const formSquads = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("tpo_form_squads" as never, {} as never);
    setBusy(false);
    if (error) {
      toast({ title: "No squads formed", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as unknown as { squads_created: number; students_placed: number; reserve: number };
    toast({
      title: r.squads_created === 0
        ? "Not enough students for a squad"
        : `${r.squads_created} squad${r.squads_created === 1 ? "" : "s"} formed`,
      description: r.squads_created === 0
        ? "A squad needs eleven students in one branch. Everyone stays in reserve until then."
        : `${r.students_placed} students placed · ${r.reserve} left in reserve.`,
    });
    void load();
  };

  const createSquad = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("tpo_create_squad", {
      _name: newSquadName.trim(),
      _cohort: newSquadCohort.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Squad not created", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as unknown as { name: string };
    toast({
      title: `${r.name} created`,
      description: "It has twelve seats and no members yet. Fill it from Assign.",
    });
    setNewSquadName("");
    setNewSquadCohort("");
    void load();
  };

  const rebalance = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("tpo_rebalance_squads" as never, {} as never);
    setBusy(false);
    if (error) {
      toast({ title: "Nothing moved", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as unknown as { students_placed: number; still_unplaced: number };
    toast({
      title: r.students_placed === 0
        ? "Everyone is already in a squad"
        : `${r.students_placed} student${r.students_placed === 1 ? "" : "s"} placed`,
      description: r.still_unplaced > 0
        ? `${r.still_unplaced} still unplaced — every unlocked squad is full.`
        : "Nobody is left in the reserve pool.",
    });
    void load();
  };

  const saveWeight = async (metric: string) => {
    const raw = weightDraft[metric];
    const points = Number(raw);
    if (raw === undefined || !Number.isFinite(points) || points < 0) return;
    setSavingWeight(metric);
    const { error } = await supabase.rpc("tpo_set_scoring_weight" as never, {
      _metric: metric, _points: points,
    } as never);
    setSavingWeight(null);
    if (error) {
      toast({ title: "Not changed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${metric.replace(/_/g, " ")} is now worth ${points} points` });
    setWeightDraft((d) => { const n = { ...d }; delete n[metric]; return n; });
    void load();
  };

  const resetWeight = async (metric: string) => {
    setSavingWeight(metric);
    const { error } = await supabase.rpc("tpo_reset_scoring_weight" as never, {
      _metric: metric,
    } as never);
    setSavingWeight(null);
    if (error) {
      toast({ title: "Not reset", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Back to the platform default" });
    void load();
  };

  const saveTheme = async (branch: string) => {
    const name = (themeDraft[branch] ?? "").trim();
    if (!name) return;
    setSavingTheme(branch);
    const { error } = await supabase.rpc("tpo_set_naming_theme" as never, {
      _branch: branch, _theme: name,
    } as never);
    setSavingTheme(null);
    if (error) {
      toast({ title: "Not changed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${branch} squads are now named after ${name}` });
    setThemeDraft((d) => { const n = { ...d }; delete n[branch]; return n; });
    void load();
  };

  const resetTheme = async (branch: string) => {
    setSavingTheme(branch);
    const { error } = await supabase.rpc("tpo_reset_naming_theme" as never, {
      _branch: branch,
    } as never);
    setSavingTheme(null);
    if (error) {
      toast({ title: "Not reset", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Back to the platform default" });
    void load();
  };

  if (!squads) return <Skeleton className="h-96 w-full rounded-xl" />;

  if (squads.length === 0) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-sm text-muted-foreground max-w-prose">
          No squads yet. A squad belongs to a season — create one and students can be
          drawn from the reserve pool into it.
        </p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Squads</h1>
        <p className="text-sm text-muted-foreground">
          Standings, members, matches and assignment.
        </p>

      </div>

      <SeasonPhaseBar status={season} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="assign">Assign</TabsTrigger>
          <TabsTrigger value="manage">Manage</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="achievements">Achievements</TabsTrigger>
          <TabsTrigger value="leaderboards">Leaderboards</TabsTrigger>
        </TabsList>

        <TabsContent value="standings" className="mt-4">
          <Card><CardContent className="pt-5 overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-3">#</th><th className="pb-2 pr-3">Squad</th>
                  <th className="pb-2 pr-3">Cohort</th>
                  <th className="pb-2 pr-3">Members</th><th className="pb-2 pr-3">Record</th>
                  <th className="pb-2 pr-3">Points</th>
                  <th className="pb-2 pr-3">Championship</th><th className="pb-2">Health</th>
                </tr>
              </thead>
              <tbody>
                {squads.map((s, i) => {
                  const mine = members.filter((m) => m.squad_id === s.id);
                  // Position is within the cohort, because that is the league
                  // this squad actually plays in.
                  const place = squads.filter(
                    (o) => o.cohort === s.cohort).findIndex((o) => o.id === s.id) + 1;
                  const active = mine.filter(
                    (m) => daysSince(m.student_profiles?.last_active ?? null) < 7).length;
                  const healthy = mine.length === 0 ? false : active / mine.length >= 0.7;
                  return (
                    <tr key={s.id} className="border-t cursor-pointer hover:bg-muted/40"
                        onClick={() => { setSelected(s.id); setTab("members"); }}>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{place}</td>
                      <td className="py-2.5 pr-3 font-medium">
                        {s.name}
                        <ChevronRight className="h-3.5 w-3.5 inline-block ml-1.5 text-muted-foreground" />
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{s.cohort ?? "—"}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">
                        {mine.length}/{s.max_members}
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{s.wins}–{s.draws ?? 0}–{s.losses}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums font-semibold">{s.points}</td>
                      <td className="py-2.5 pr-3">
                        {s.qualified === null
                          ? <span className="text-xs text-muted-foreground">League stage</span>
                          : s.qualified
                            ? <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                                Through{s.seed ? ` · seed ${s.seed}` : ""}
                              </Badge>
                            : <span className="text-xs text-muted-foreground">
                                Still learning, out of the race
                              </span>}
                      </td>
                      <td className="py-2.5">
                        {healthy
                          ? <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">Healthy</Badge>
                          : <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">Needs attention</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex items-center gap-3 flex-wrap mt-4 pt-3 border-t">
              <p className="text-xs text-muted-foreground">
                Scored automatically every Monday from what each member did that week.
                The match schedule — who plays whom, and in which week — is drawn as
                soon as a season has two squads.
              </p>
              <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs"
                      disabled={busy} onClick={() => void runWeek()}>
                {busy ? "Working…" : "Recalculate now"}
              </Button>
              {/* A squad added after the draw has no fixtures, and the nightly
                  job only draws for a season that has none at all — so redrawing
                  stays reachable, and refuses rather than discarding results. */}
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                      disabled={busy} onClick={() => void fixtures()}>
                Redo match schedule
              </Button>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="overview" className="mt-4">
          {current && (
            <Card><CardContent className="pt-5">
              <h2 className="text-xl font-semibold">{current.name}</h2>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { k: "Rank", v: current.rank ? `#${current.rank}` : "—" },
                  { k: "Points", v: current.points },
                  { k: "Record", v: `${current.wins}–${current.draws ?? 0}–${current.losses}` },
                  { k: "Members", v: `${currentMembers.length}/${current.max_members}` },
                ].map(({ k, v }) => (
                  <div key={k} className="rounded-lg bg-muted/50 p-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{k}</span>
                    <div className="font-mono text-xl font-semibold tabular-nums mt-1">{v}</div>
                  </div>
                ))}
              </div>
              {(() => {
                const quiet = currentMembers.filter(
                  (m) => daysSince(m.student_profiles?.last_active ?? null) >= 7);
                return quiet.length > 0 ? (
                  <div className="text-sm mt-4 flex items-center gap-2 flex-wrap">
                    <span className="text-destructive font-medium">{quiet.length} member
                      {quiet.length > 1 ? "s need" : " needs"} attention</span>
                    {quiet.map((m) => (
                      <Button key={m.student_id} size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => setOpenStudent(m.student_id)}>
                        {m.student_profiles?.full_name}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-4">Every member has been active this week.</p>
                );
              })()}
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <Card><CardContent className="pt-5 overflow-x-auto">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
              {current?.name} · {currentMembers.length} members
            </p>
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-3">Student</th><th className="pb-2 pr-3">Roll no.</th>
                  <th className="pb-2 pr-3">Role</th><th className="pb-2 pr-3">Contribution</th>
                  <th className="pb-2">Recency</th>
                </tr>
              </thead>
              <tbody>
                {currentMembers.map((m) => {
                  const d = daysSince(m.student_profiles?.last_active ?? null);
                  return (
                    <tr key={m.student_id}
                        className="border-t cursor-pointer hover:bg-muted/40"
                        onClick={() => setOpenStudent(m.student_id)}>
                      <td className="py-2.5 pr-3">{m.student_profiles?.full_name ?? "—"}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{m.student_profiles?.roll_number ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{m.membership_type}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{m.contribution}</td>
                      <td className={`py-2.5 font-mono tabular-nums ${d >= 7 ? "text-destructive" : "text-muted-foreground"}`}>
                        {d >= 999 ? "never" : `${d}d`}
                        <ChevronRight className="h-3.5 w-3.5 inline-block ml-2 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
                {currentMembers.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Nobody in this squad yet.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="matches" className="mt-4">
          <Card><CardContent className="pt-5 overflow-x-auto">
            {matches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matches scheduled yet.</p>
            ) : (
              <table className="w-full text-sm min-w-[460px]">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="pb-2 pr-3">Match</th><th className="pb-2 pr-3">Stage</th>
                    <th className="pb-2 pr-3">Week</th>
                    <th className="pb-2 pr-3">When</th><th className="pb-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="py-2.5 pr-3">
                        {names[m.home_squad] ?? "?"}
                        <span className="text-muted-foreground"> vs </span>
                        {names[m.away_squad] ?? "?"}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        {m.stage === "league"
                          ? <span className="text-muted-foreground">{m.cohort ?? "League"}</span>
                          : <Badge variant="secondary" className="capitalize">{m.stage}</Badge>}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground font-mono text-xs">
                        {m.round_number ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground font-mono text-xs">
                        {format(new Date(m.scheduled_at), "d MMM")}
                      </td>
                      <td className="py-2.5 font-mono text-xs">
                        {m.status === "played" && m.home_points != null
                          ? `${m.home_points}–${m.away_points}`
                          : <span className="text-primary">{m.status}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="assign" className="mt-4">
          <Card><CardContent className="pt-5">
            <p className="text-sm text-muted-foreground max-w-prose">
              {reserves.length} {reserves.length === 1 ? "student is" : "students are"} waiting to
              be placed. Squads are drawn as elevens, so whatever a section does not divide into
              elevens is left here for you rather than spread around to make uneven squads. Every
              squad has a twelfth seat free for exactly this. Put a student wherever you judge is
              right — moving them closes any previous membership rather than deleting it, and the
              change is recorded.
            </p>

            <div className="flex flex-wrap gap-2 mt-4">
              <Select value={pickStudent} onValueChange={setPickStudent}>
                <SelectTrigger className="w-[260px]"><SelectValue placeholder="Choose a reserve student" /></SelectTrigger>
                <SelectContent>
                  {reserves.map((s) => (
                    <SelectItem key={s.student_id} value={s.student_id}>
                      {s.cohort ? `${s.cohort} · ` : ""}{s.full_name}
                      {s.roll_number ? ` · ${s.roll_number}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={pickSquad} onValueChange={setPickSquad}>
                <SelectTrigger className="w-[190px]"><SelectValue placeholder="Into which squad" /></SelectTrigger>
                <SelectContent>
                  {squads.map((s) => {
                    const n = members.filter((m) => m.squad_id === s.id).length;
                    return (
                      <SelectItem key={s.id} value={s.id} disabled={n >= s.max_members}>
                        {s.name} ({n}/{s.max_members})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              <Select value={when} onValueChange={setWhen}>
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="now">Immediately</SelectItem>
                  <SelectItem value="monday">Next Monday</SelectItem>
                </SelectContent>
              </Select>

              <Button disabled={!pickStudent || !pickSquad || busy} onClick={() => void assign()}>
                {busy ? "Assigning…" : "Confirm assignment"}
              </Button>
            </div>

            {reserves.length === 0 && (
              <p className="text-sm text-muted-foreground mt-4">
                Nobody is in reserve — every student is already in a squad.
              </p>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="manage" className="mt-4 space-y-4">
          <Card><CardContent className="pt-5">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                The reserve pool
              </span>
              <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                {reserves.length} unplaced
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-2 max-w-prose">
              Forming draws squads of exactly eleven, one section at a time, ranking students by
              what they have done and dealing them out in a snake so no squad collects all the
              strongest. Whatever does not divide into eleven stays here and is yours to place —
              a section of fewer than eleven makes no squad at all. Rebalancing does not draw
              anything: it drops unplaced students into the emptiest squad of their own section
              that still has room, skipping locked and archived ones, so freeze a squad first if
              it should be left alone.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button disabled={busy} onClick={() => void formSquads()}>
                <Swords className="h-4 w-4 mr-1.5" />
                {busy ? "Working…" : "Form squads"}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void rebalance()}>
                <Shuffle className="h-4 w-4 mr-1.5" />
                {busy ? "Working…" : "Rebalance the reserve pool"}
              </Button>
            </div>

            <div className="mt-5 pt-4 border-t">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Make a squad yourself
              </span>
              <p className="text-sm text-muted-foreground mt-2 max-w-prose">
                For a section too small to draw one, or when the students left over deserve a
                squad of their own rather than the spare seats. It starts empty with twelve
                seats; fill it from Assign. Give it the section it belongs to, or its league
                will have nobody to play.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Input
                  className="h-9 w-[240px]" placeholder="Squad name"
                  value={newSquadName} onChange={(e) => setNewSquadName(e.target.value)}
                />
                <Input
                  className="h-9 w-[150px]" placeholder="Section, e.g. CSE-D"
                  value={newSquadCohort} onChange={(e) => setNewSquadCohort(e.target.value)}
                />
                <Button variant="outline" disabled={busy || !newSquadName.trim()}
                        onClick={() => void createSquad()}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  {busy ? "Working…" : "Create squad"}
                </Button>
              </div>
            </div>
          </CardContent></Card>

          <Card><CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              How points are earned
            </span>
            <p className="text-sm text-muted-foreground mt-2 max-w-prose">
              Every weekly score and squad ranking is built from these. Change one and it applies
              to your college only, starting with the next week that gets scored — nothing already
              published is recalculated.
            </p>
            <div className="mt-3 space-y-2">
              {scoringRules.map((r) => (
                <div key={r.metric} className="flex items-center gap-3 flex-wrap rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{r.label}</span>
                      {r.customized && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          Customized — default {r.default_points}
                        </Badge>
                      )}
                    </div>
                    {r.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                    )}
                  </div>
                  <Input
                    type="number" min={0} max={1000}
                    className="h-9 w-24"
                    value={weightDraft[r.metric] ?? String(r.points)}
                    onChange={(e) => setWeightDraft((d) => ({ ...d, [r.metric]: e.target.value }))}
                  />
                  <Button
                    variant="outline" className="h-9"
                    disabled={savingWeight === r.metric || weightDraft[r.metric] === undefined}
                    onClick={() => void saveWeight(r.metric)}
                  >
                    Save
                  </Button>
                  {r.customized && (
                    <Button
                      variant="ghost" className="h-9"
                      disabled={savingWeight === r.metric}
                      onClick={() => void resetWeight(r.metric)}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent></Card>

          <Card><CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Squad names
            </span>
            <p className="text-sm text-muted-foreground mt-2 max-w-prose">
              Each branch gets a theme word — your town, then "Warriors", then this — the way a real
              league names a team ("Surampalem Warriors Titans"). Change it per branch; new squads
              use it the next time they're formed. Existing squad names do not change.
            </p>
            <div className="mt-3 space-y-2">
              {namingThemes.map((t) => (
                <div key={t.branch} className="flex items-center gap-3 flex-wrap rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {t.branch === "*" ? "Any other branch" : t.branch}
                      </span>
                      {t.customized && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          Customized — default {t.default_theme}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Input
                    className="h-9 w-40"
                    placeholder={t.theme}
                    value={themeDraft[t.branch] ?? t.theme}
                    onChange={(e) => setThemeDraft((d) => ({ ...d, [t.branch]: e.target.value }))}
                  />
                  <Button
                    variant="outline" className="h-9"
                    disabled={savingTheme === t.branch || !(themeDraft[t.branch] ?? "").trim()}
                    onClick={() => void saveTheme(t.branch)}
                  >
                    Save
                  </Button>
                  {t.customized && (
                    <Button
                      variant="ghost" className="h-9"
                      disabled={savingTheme === t.branch}
                      onClick={() => void resetTheme(t.branch)}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent></Card>

          {squads.map((s) => {
            const live = members.filter((m) => m.squad_id === s.id).length;
            const archived = s.archived_at != null;
            return (
              <Card key={s.id} className={archived ? "opacity-60" : ""}>
                <CardContent className="pt-5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h3 className="font-semibold">{s.name}</h3>
                    {s.is_locked && (
                      <Badge variant="outline" className="text-[10px] font-normal">Locked</Badge>
                    )}
                    {archived && (
                      <Badge variant="outline" className="text-[10px] font-normal">Archived</Badge>
                    )}
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                      {live}/{s.max_members} members
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={"name-" + s.id} className="text-xs">Rename</Label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          id={"name-" + s.id}
                          defaultValue={s.name}
                          onChange={(e) => setRename((r) => ({ ...r, [s.id]: e.target.value }))}
                          className="h-9"
                        />
                        <Button
                          variant="outline" className="h-9"
                          disabled={busy || !(rename[s.id] ?? "").trim()}
                          onClick={() => void manage(s.id, { _name: (rename[s.id] ?? "").trim() },
                            "Renamed to " + (rename[s.id] ?? "").trim())}
                        >
                          Save
                        </Button>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor={"cap-" + s.id} className="text-xs">Size limit</Label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          id={"cap-" + s.id}
                          type="number" min={1} defaultValue={s.max_members}
                          onChange={(e) => setCapacity((c) => ({ ...c, [s.id]: e.target.value }))}
                          className="h-9"
                        />
                        <Button
                          variant="outline" className="h-9"
                          disabled={busy || !capacity[s.id]}
                          onClick={() => void manage(s.id, { _max_members: Number(capacity[s.id]) },
                            s.name + " now holds up to " + capacity[s.id])}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2 flex-wrap">
                    <Button
                      variant="outline" size="sm" disabled={busy}
                      onClick={() => void manage(s.id, { _is_locked: !s.is_locked },
                        s.is_locked
                          ? s.name + " unlocked"
                          : s.name + " locked — nobody can be moved in")}
                    >
                      {s.is_locked
                        ? <><Unlock className="h-3.5 w-3.5 mr-1.5" />Unlock</>
                        : <><Lock className="h-3.5 w-3.5 mr-1.5" />Lock</>}
                    </Button>
                    <Button
                      variant="outline" size="sm" disabled={busy}
                      onClick={() => void manage(s.id, { _archived: !archived },
                        archived ? s.name + " restored" : s.name + " archived")}
                    >
                      {archived
                        ? <><ArchiveRestore className="h-3.5 w-3.5 mr-1.5" />Restore</>
                        : <><Archive className="h-3.5 w-3.5 mr-1.5" />Archive</>}
                    </Button>
                  </div>

                  {/* Archiving keeps the squad and its record. Nothing here
                      deletes: a squad that played eight weeks is eight weeks of
                      results, and those results belong to the students in it. */}
                  <p className="text-xs text-muted-foreground mt-3 max-w-prose">
                    {archived
                      ? "Archived squads keep their history and standings but take no new members."
                      : "Locking stops assignment and rebalancing from touching this squad."}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <Card><CardContent className="pt-5 overflow-x-auto">
            {performance.length === 0 ? (
              <p className="text-sm text-muted-foreground max-w-prose">
                No weeks scored yet. Scoring runs every Monday, and Standings has a button to run
                it now — after the first week this fills with points, participation and the change
                on the week before.
              </p>
            ) : (
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="pb-2 pr-3">Week</th><th className="pb-2 pr-3">Squad</th>
                    <th className="pb-2 pr-3">Points</th><th className="pb-2 pr-3">Change</th>
                    <th className="pb-2 pr-3">Active</th><th className="pb-2">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((p) => (
                    <tr key={p.squad_id + "-" + p.week} className="border-t cursor-pointer hover:bg-muted/40"
                        onClick={() => { setSelected(p.squad_id); setTab("members"); }}>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{p.week}</td>
                      <td className="py-2.5 pr-3 font-medium">{p.squad_name}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums font-semibold">{p.points}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">
                        {p.change == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : p.change >= 0 ? (
                          <span className="text-emerald-500 inline-flex items-center gap-1">
                            <TrendingUp className="h-3 w-3" />+{p.change}
                          </span>
                        ) : (
                          <span className="text-destructive inline-flex items-center gap-1">
                            <TrendingDown className="h-3 w-3" />{p.change}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">
                        {p.active_members}/{p.total_members}
                        <span className="text-muted-foreground"> · {Number(p.participation)}%</span>
                      </td>
                      <td className="py-2.5 font-mono tabular-nums">{p.rank ? "#" + p.rank : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="leaderboards" className="mt-4">
          <SeasonLeaderboards />
        </TabsContent>

        <TabsContent value="achievements" className="mt-4">
          <Card><CardContent className="pt-5 overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-3">Squad</th><th className="pb-2 pr-3">Record</th>
                  <th className="pb-2 pr-3">Weeks led</th><th className="pb-2 pr-3">Best rank</th>
                  <th className="pb-2 pr-3">Best week</th><th className="pb-2">Badges</th>
                </tr>
              </thead>
              <tbody>
                {achievements.map((a) => (
                  <tr key={a.squad_id} className="border-t cursor-pointer hover:bg-muted/40"
                      onClick={() => { setSelected(a.squad_id); setTab("members"); }}>
                    <td className="py-2.5 pr-3 font-medium">
                      {a.squad_name}
                      {a.archived && (
                        <Badge variant="outline" className="ml-2 text-[10px] font-normal">Archived</Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">{a.wins}–{a.draws ?? 0}–{a.losses}</td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">{a.weeks_led}</td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">
                      {a.best_rank ? "#" + a.best_rank : "—"}
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">
                      {a.best_week_points ?? "—"}
                    </td>
                    <td className="py-2.5 font-mono tabular-nums">{a.member_badges}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-3 max-w-prose">
              Counted from the match results and the weekly scores. Nothing here is entered by
              hand, so it cannot disagree with the standings.
            </p>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <TpoStudentProfile
        studentId={openStudent}
        onClose={() => setOpenStudent(null)}
        onOpenSquad={(id) => { setSelected(id); setTab("members"); }}
        onChanged={() => void load()}
      />
    </div>
  );
};

function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

export default TpoSquads;
