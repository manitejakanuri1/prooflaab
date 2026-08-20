import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Video } from "lucide-react";
import { format } from "date-fns";

interface Squad {
  id: string;
  name: string;
  points: number;
  wins: number;
  losses: number;
  rank: number | null;
  previous_rank: number | null;
  max_members: number;
}

interface Member {
  student_id: string;
  role: string | null;
  contribution: number;
  meet_url: string | null;
  student_profiles: { full_name: string; total_xp: number } | null;
}

interface Match {
  id: string;
  scheduled_at: string;
  status: string;
  home_points: number | null;
  away_points: number | null;
  home_squad: string;
  away_squad: string;
}

/**
 * Squad — one destination, four views.
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

  const load = useCallback(async () => {
    if (!profile?.id) return;

    const { data: membership } = await supabase
      .from("squad_members")
      .select("squad_id")
      .eq("student_id", profile.id)
      .maybeSingle();

    if (!membership) { setLoading(false); return; }

    const [squadRes, memberRes, matchRes, standingRes] = await Promise.all([
      supabase.from("squads").select("*").eq("id", membership.squad_id).maybeSingle(),
      supabase
        .from("squad_members")
        .select("student_id, role, contribution, meet_url, student_profiles(full_name, total_xp)")
        .eq("squad_id", membership.squad_id)
        .order("contribution", { ascending: false }),
      supabase
        .from("squad_matches")
        .select("*")
        .or(`home_squad.eq.${membership.squad_id},away_squad.eq.${membership.squad_id}`)
        .order("scheduled_at", { ascending: false })
        .limit(10),
      // Everyone's standings, not just ours — a league you cannot see the rest
      // of is a scoreboard with one row on it.
      supabase.from("squads").select("*").order("points", { ascending: false }).limit(20),
    ]);

    setSquad(squadRes.data as Squad | null);
    setMembers((memberRes.data ?? []) as unknown as Member[]);
    setMatches((matchRes.data ?? []) as Match[]);
    setStandings((standingRes.data ?? []) as Squad[]);
    setNames(Object.fromEntries(((standingRes.data ?? []) as Squad[]).map((s) => [s.id, s.name])));
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { void load(); }, [load]);

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
          <p className="text-sm text-muted-foreground max-w-prose">
            You are not in a squad yet. Squads are formed by your college — once you are placed in
            one, this is where you will see your team's rank and points, who is active, your
            upcoming matches and the full standings.
          </p>
          <div className="grid gap-2 sm:grid-cols-4">
            {["Overview", "Members", "Matches", "Standings"].map((v) => (
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

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold tracking-tight">
          THE <span className="text-primary">LAB</span>
        </h1>
        <span className="ml-auto font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {squad.rank ? `Rank #${squad.rank}` : "Unranked"}
        </span>
      </div>

      <Card>
        <CardContent className="pt-5">
          <h2 className="text-xl font-semibold">{squad.name}</h2>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
            {members.length} of {squad.max_members} members
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { k: "Points", v: squad.points },
              { k: "Record", v: `${squad.wins}–${squad.losses}` },
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

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="standings">Standings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card>
            <CardContent className="pt-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Next match
              </span>
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
              ) : (
                <p className="text-sm text-muted-foreground mt-2">Nothing scheduled yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Squad pulse
              </span>
              <p className="text-sm mt-2">
                {members.filter((m) => m.contribution > 0).length} of {members.length} members have
                contributed. {members.filter((m) => m.contribution === 0).length} need a nudge.
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
                    <th className="pb-2 pr-3">Contribution</th>
                    <th className="pb-2"></th>
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
                      <td className="py-2.5 pr-3 text-muted-foreground">{m.role ?? "—"}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{m.contribution}</td>
                      <td className="py-2.5">
                        {m.meet_url && (
                          <a
                            href={m.meet_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Video className="h-3 w-3" /> Meet
                          </a>
                        )}
                      </td>
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
                      return (
                        <tr key={m.id} className="border-t">
                          <td className="py-2.5 pr-3">
                            vs {names[home ? m.away_squad : m.home_squad] ?? "?"}
                          </td>
                          <td className="py-2.5 pr-3 text-muted-foreground">
                            {format(new Date(m.scheduled_at), "d MMM")}
                          </td>
                          <td className="py-2.5 font-mono text-xs">
                            {m.status === "played" && us != null ? (
                              <span className={won ? "text-emerald-500" : "text-destructive"}>
                                {won ? "Won" : "Lost"} {us}–{them}
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
                    <th className="pb-2 pr-3">Points</th>
                    <th className="pb-2 pr-3">W</th>
                    <th className="pb-2">L</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => (
                    <tr key={s.id} className={`border-t ${s.id === squad.id ? "bg-primary/5" : ""}`}>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{i + 1}</td>
                      <td className="py-2.5 pr-3">
                        {s.name}
                        {s.id === squad.id && (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">you</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{s.points}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{s.wins}</td>
                      <td className="py-2.5 font-mono tabular-nums">{s.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default StudentSquadPage;
