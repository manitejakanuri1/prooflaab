import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Squad {
  id: string; name: string; points: number; wins: number; losses: number;
  rank: number | null; max_members: number;
}
interface Member {
  student_id: string; squad_id: string; contribution: number; membership_type: string;
  student_profiles: { full_name: string; roll_number: string | null; last_active: string | null } | null;
}
interface Match {
  id: string; scheduled_at: string; status: string;
  home_squad: string; away_squad: string;
  home_points: number | null; away_points: number | null;
}
interface StudentRow {
  student_id: string; full_name: string; roll_number: string | null; is_reserve: boolean;
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
const TpoSquads = () => {
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
      .order("points", { ascending: false });

    const list = (sqData ?? []) as unknown as Squad[];
    setSquads(list);

    if (list.length === 0) { setMembers([]); setMatches([]); return; }
    const ids = list.map((s) => s.id);

    const [mem, mat, stu] = await Promise.all([
      supabase.from("squad_members")
        .select("student_id, squad_id, contribution, membership_type, student_profiles(full_name, roll_number, last_active)")
        .in("squad_id", ids)
        .is("left_at", null),
      supabase.from("squad_matches").select("*")
        .or(`home_squad.in.(${ids.join(",")}),away_squad.in.(${ids.join(",")})`)
        .order("scheduled_at", { ascending: false }).limit(20),
      supabase.rpc("tpo_students" as never),
    ]);

    setMembers((mem.data ?? []) as unknown as Member[]);
    setMatches((mat.data ?? []) as unknown as Match[]);
    setStudents((stu.data ?? []) as unknown as StudentRow[]);
    if (list.length && !selected) setSelected(list[0].id);
  }, [selected]);

  useEffect(() => { void load(); }, [load]);

  const names = useMemo(
    () => Object.fromEntries((squads ?? []).map((s) => [s.id, s.name])), [squads]);
  const current = (squads ?? []).find((s) => s.id === selected) ?? null;
  const currentMembers = members.filter((m) => m.squad_id === selected);
  const reserves = students.filter((s) => s.is_reserve);

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

      <Tabs defaultValue="standings">
        <TabsList>
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="assign">Assign</TabsTrigger>
        </TabsList>

        <TabsContent value="standings" className="mt-4">
          <Card><CardContent className="pt-5 overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-3">#</th><th className="pb-2 pr-3">Squad</th>
                  <th className="pb-2 pr-3">Members</th><th className="pb-2 pr-3">Record</th>
                  <th className="pb-2 pr-3">Points</th><th className="pb-2">Health</th>
                </tr>
              </thead>
              <tbody>
                {squads.map((s, i) => {
                  const mine = members.filter((m) => m.squad_id === s.id);
                  const active = mine.filter(
                    (m) => daysSince(m.student_profiles?.last_active ?? null) < 7).length;
                  const healthy = mine.length === 0 ? false : active / mine.length >= 0.7;
                  return (
                    <tr key={s.id} className="border-t cursor-pointer hover:bg-muted/40"
                        onClick={() => setSelected(s.id)}>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{i + 1}</td>
                      <td className="py-2.5 pr-3 font-medium">{s.name}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">
                        {mine.length}/{s.max_members}
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{s.wins}–{s.losses}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums font-semibold">{s.points}</td>
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
                  { k: "Record", v: `${current.wins}–${current.losses}` },
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
                  <p className="text-sm mt-4">
                    <span className="text-destructive font-medium">{quiet.length} member
                      {quiet.length > 1 ? "s need" : " needs"} attention</span>
                    {" — "}{quiet.map((m) => m.student_profiles?.full_name).join(", ")}
                  </p>
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
                    <tr key={m.student_id} className="border-t">
                      <td className="py-2.5 pr-3">{m.student_profiles?.full_name ?? "—"}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{m.student_profiles?.roll_number ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{m.membership_type}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{m.contribution}</td>
                      <td className={`py-2.5 font-mono tabular-nums ${d >= 7 ? "text-destructive" : "text-muted-foreground"}`}>
                        {d >= 999 ? "never" : `${d}d`}
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
                    <th className="pb-2 pr-3">Match</th><th className="pb-2 pr-3">When</th><th className="pb-2">Result</th>
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
              {reserves.length} {reserves.length === 1 ? "student is" : "students are"} in reserve.
              A reserve is simply a student with no active squad — moving them here closes any
              previous membership rather than deleting it, and records the change.
            </p>

            <div className="flex flex-wrap gap-2 mt-4">
              <Select value={pickStudent} onValueChange={setPickStudent}>
                <SelectTrigger className="w-[260px]"><SelectValue placeholder="Choose a reserve student" /></SelectTrigger>
                <SelectContent>
                  {reserves.map((s) => (
                    <SelectItem key={s.student_id} value={s.student_id}>
                      {s.full_name}{s.roll_number ? ` · ${s.roll_number}` : ""}
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
      </Tabs>
    </div>
  );
};

function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

export default TpoSquads;
