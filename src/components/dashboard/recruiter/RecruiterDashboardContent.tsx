import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, Mail, Lock, Search } from "lucide-react";
import ProofProfile from "./ProofProfile";
import type { Candidate } from "@/recruiter/types";
import {
  loadHome, loadTalent, loadFilters, loadProfile, loadShortlist, loadLots,
  shortlist as saveShortlist, sponsorLot, recordOutcome,
} from "@/recruiter/data";

/**
 * Four sections, as the architecture specifies: Home, Talent, Shortlist, Lots.
 *
 * The Proof Profile arrives as a dialog from any of them rather than as a fifth
 * navigation entry — a recruiter reaches a candidate from wherever they found
 * them, and should not lose their place doing it.
 */

interface Props {
  activeTab: string;
  onTabChange?: (tab: string) => void;
}

const OUTCOMES = [
  "saved", "contacted", "sponsored", "interviewing", "offered", "hired", "passed",
] as const;

const RecruiterDashboardContent = ({ activeTab, onTabChange }: Props) => {
  const { toast } = useToast();
  const [home, setHome] = useState<Record<string, any> | null>(null);
  const [talent, setTalent] = useState<Candidate[] | null>(null);
  const [filters, setFilters] = useState<Record<string, any> | null>(null);
  const [saved, setSaved] = useState<Record<string, any>[]>([]);
  const [lots, setLots] = useState<Record<string, any>[]>([]);

  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [skill, setSkill] = useState("all");

  const [open, setOpen] = useState<Candidate | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // sponsoring
  const [sponsorFor, setSponsorFor] = useState<{ id: string; name: string } | null>(null);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [criteria, setCriteria] = useState("");

  const refresh = useCallback(async () => {
    const [h, f] = await Promise.all([loadHome(), loadFilters()]);
    setHome(h);
    setFilters(f);
    if (f?.verified) {
      const [t, s, l] = await Promise.all([loadTalent(), loadShortlist(), loadLots()]);
      setTalent(t);
      setSaved(s as Record<string, any>[]);
      setLots(l);
    } else {
      setTalent([]);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const applyFilters = async () => {
    setTalent(null);
    setTalent(await loadTalent({
      role: role === "all" ? undefined : role,
      skills: skill === "all" ? undefined : [skill],
    }));
  };

  const openProfile = async (studentId: string) => {
    const p = await loadProfile(studentId);
    if (!p) {
      toast({ title: "Not available", description: "That candidate is no longer discoverable.",
              variant: "destructive" });
      return;
    }
    setOpen(p);
    setNote(p.notes ?? "");
  };

  const doShortlist = async () => {
    if (!open) return;
    setBusy(true);
    try {
      await saveShortlist(open.id, note);
      toast({ title: `${open.name} shortlisted`,
              description: "They have been told, and choose whether to share their contact details." });
      await refresh();
      setOpen(null);
    } catch (e) {
      toast({ title: "Not shortlisted", description: (e as Error).message, variant: "destructive" });
    }
    setBusy(false);
  };

  const doSponsor = async () => {
    if (!sponsorFor) return;
    setBusy(true);
    try {
      await sponsorLot(sponsorFor.id, title, brief, criteria);
      toast({ title: `Task sent to ${sponsorFor.name}`,
              description: "It is on their Daily Card. You will see the submission here." });
      setSponsorFor(null); setTitle(""); setBrief(""); setCriteria("");
      await refresh();
    } catch (e) {
      toast({ title: "Not sent", description: (e as Error).message, variant: "destructive" });
    }
    setBusy(false);
  };

  const setStage = async (studentId: string, outcome: string) => {
    try {
      await recordOutcome(studentId, outcome);
      toast({ title: `Moved to ${outcome}` });
      await refresh();
    } catch (e) {
      toast({ title: "Not changed", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (!home) return <Skeleton className="h-96 w-full rounded-xl" />;

  // Awaiting verification: the honest screen, not an empty dashboard that looks
  // broken.
  if (home.verified === false) {
    return (
      <Card><CardContent className="pt-6">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {home.company}
        </span>
        <h2 className="text-xl font-semibold mt-1">Awaiting verification</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-prose">{home.message}</p>
      </CardContent></Card>
    );
  }

  const visible = (talent ?? []).filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
    || c.roleFit.join(" ").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      {/* ── HOME ─────────────────────────────────────────────── */}
      {activeTab === "home" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { k: "Candidates", v: home.candidates_available, go: "talent" },
              { k: "New this week", v: home.new_this_week, go: "talent" },
              { k: "Shortlisted", v: home.shortlisted, go: "shortlist" },
              { k: "Awaiting reply", v: home.awaiting_response, go: "shortlist" },
            ].map((c) => (
              <Card key={c.k}
                    className={Number(c.v) > 0 ? "cursor-pointer transition-colors hover:border-primary" : ""}
                    onClick={() => Number(c.v) > 0 && onTabChange?.(c.go)}>
                <CardContent className="pt-5">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.k}
                  </span>
                  <div className="font-mono text-2xl font-semibold tabular-nums mt-1">{c.v ?? 0}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardContent className="pt-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Recommended — strongest evidence, not yet saved
              </span>
              {(home.recommended ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground mt-2">
                  Nobody new. Everyone matching is already on your shortlist.
                </p>
              ) : (
                <div className="mt-3">
                  {(home.recommended as Record<string, any>[]).map((c) => (
                    <button key={c.student_id}
                            onClick={() => void openProfile(c.student_id)}
                            className="w-full flex items-center gap-3 py-3 border-b last:border-b-0 text-left hover:bg-muted/40 rounded px-1 -mx-1">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{c.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[c.branch, c.target_role].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {c.skills_proven} proven · {c.proofs_verified} verified
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Sponsored work
              </span>
              <p className="text-sm mt-2">
                <span className="font-mono text-lg font-semibold tabular-nums">{home.lots_open ?? 0}</span>
                <span className="text-muted-foreground"> open · </span>
                <span className="font-mono text-lg font-semibold tabular-nums">{home.lots_submitted ?? 0}</span>
                <span className="text-muted-foreground"> submitted</span>
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── TALENT ───────────────────────────────────────────── */}
      {activeTab === "talent" && (
        <>
          <Card>
            <CardContent className="pt-5">
              <div className="flex gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)}
                         placeholder="Search by name or role" className="pl-9" />
                </div>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-[190px]"><SelectValue placeholder="Any role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any role</SelectItem>
                    {(filters?.roles ?? []).map((r: string) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={skill} onValueChange={setSkill}>
                  <SelectTrigger className="w-[170px]"><SelectValue placeholder="Any skill" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any skill</SelectItem>
                    {(filters?.skills ?? []).map((s: string) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={() => void applyFilters()}>Apply</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 overflow-x-auto">
              {talent === null ? (
                <Skeleton className="h-40 w-full rounded-lg" />
              ) : visible.length === 0 ? (
                <p className="text-sm text-muted-foreground max-w-prose">
                  No candidates match. Students appear here only after they choose to be
                  discoverable, so a narrow filter on a young cohort finds nothing quickly.
                </p>
              ) : (
                <table className="w-full text-sm min-w-[620px]">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      <th className="pb-2 pr-3">Candidate</th>
                      <th className="pb-2 pr-3">Role</th>
                      <th className="pb-2 pr-3">Skills proven</th>
                      <th className="pb-2 pr-3">Verified work</th>
                      <th className="pb-2 pr-3">Comms</th>
                      <th className="pb-2">Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => (
                      <tr key={c.id} className="border-t cursor-pointer hover:bg-muted/40"
                          onClick={() => void openProfile(c.id)}>
                        <td className="py-2.5 pr-3 font-medium">
                          {c.name}
                          {c.shortlisted && (
                            <Badge variant="outline" className="ml-2 text-[10px] font-normal">saved</Badge>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground">{c.roleFit[0] ?? "—"}</td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums">
                          {c.skillsProven ?? 0}
                        </td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums">{c.proofsVerified ?? 0}</td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums">{c.communicationScore || "—"}</td>
                        <td className="py-2.5 text-muted-foreground">{c.lastActive}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ── SHORTLIST ────────────────────────────────────────── */}
      {activeTab === "shortlist" && (
        <Card>
          <CardContent className="pt-5">
            {saved.length === 0 ? (
              <p className="text-sm text-muted-foreground max-w-prose">
                Nobody saved yet. Open a candidate from Talent and shortlist them — they are
                told, and choose whether to share their contact details.
              </p>
            ) : (
              <div>
                {saved.map((s) => (
                  <div key={s.id} className="py-3 border-b last:border-b-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <button className="text-sm font-medium hover:underline"
                              onClick={() => void openProfile(s.student_id)}>
                        Open candidate
                      </button>
                      <Badge variant="outline" className="text-[10px] font-normal">{s.stage}</Badge>
                      {s.student_response === "accepted" && (
                        <Badge className="text-[10px] font-normal bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                          accepted
                        </Badge>
                      )}
                      {s.student_response === "declined" && (
                        <Badge variant="outline" className="text-[10px] font-normal">declined</Badge>
                      )}
                      {!s.student_response && (
                        <span className="text-xs text-muted-foreground">awaiting their answer</span>
                      )}
                    </div>
                    {s.note && <p className="text-sm text-muted-foreground mt-1">{s.note}</p>}

                    <div className="mt-2 flex gap-2 flex-wrap">
                      <Select value={s.stage} onValueChange={(v) => void setStage(s.student_id, v)}>
                        <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {OUTCOMES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" className="h-8"
                              onClick={() => setSponsorFor({ id: s.student_id, name: "this candidate" })}>
                        Sponsor a task
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── LOTS ─────────────────────────────────────────────── */}
      {activeTab === "lots" && (
        <Card>
          <CardContent className="pt-5 overflow-x-auto">
            {lots.length === 0 ? (
              <p className="text-sm text-muted-foreground max-w-prose">
                No sponsored work yet. Shortlist a candidate first, then set them a task — it
                lands on their Daily Card like any other piece of work.
              </p>
            ) : (
              <table className="w-full text-sm min-w-[620px]">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="pb-2 pr-3">Task</th><th className="pb-2 pr-3">Candidate</th>
                    <th className="pb-2 pr-3">Due</th><th className="pb-2 pr-3">Submitted</th>
                    <th className="pb-2">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l) => (
                    <tr key={String(l.task_id)} className="border-t">
                      <td className="py-2.5 pr-3 font-medium">{String(l.title)}</td>
                      <td className="py-2.5 pr-3">
                        <button className="hover:underline"
                                onClick={() => void openProfile(String(l.student_id))}>
                          {String(l.student_name)}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                        {String(l.due_date ?? "").slice(0, 10)}
                      </td>
                      <td className="py-2.5 pr-3">
                        {/* recruiter_lots() reads task_submissions since migration 54 (it read proof_uploads, so nothing ever showed). */}
                        {l.submission_id ? (
                          <span className={l.submission_status === "passed" ? "text-emerald-600" : "text-amber-600"}>
                            {l.submission_status === "passed" ? "Passed" : l.submission_status === "needs_review" ? "Needs review" : "Not passed"}
                            {l.score != null ? ` · ${String(l.score)}/100` : ""}
                            {l.voice_status === "scored" ? " · explained" : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">not yet</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {String(l.outcome ?? "—")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── the Proof Profile, over whatever you were looking at ── */}
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{open?.name}</DialogTitle></DialogHeader>
          {open && (
            <div className="space-y-4">
              {/* Contact: the one thing a shortlist buys, and only if they agreed. */}
              <Card>
                <CardContent className="pt-5">
                  {open.contactUnlocked && open.contact ? (
                    <div className="flex items-center gap-3 flex-wrap">
                      <Mail className="h-4 w-4 text-emerald-600" />
                      <span className="text-sm">{open.contact.email}</span>
                      {open.contact.phone && (
                        <span className="text-sm text-muted-foreground">· {open.contact.phone}</span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <Lock className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">Contact details are hidden</p>
                        <p className="text-xs text-muted-foreground mt-0.5 max-w-prose">
                          They unlock if this candidate accepts your shortlist. Being findable is
                          not the same as agreeing to be approached.
                        </p>
                      </div>
                      {!open.shortlisted && (
                        <div className="flex gap-2">
                          <Input value={note} onChange={(e) => setNote(e.target.value)}
                                 placeholder="Why them? (optional)" className="h-9 w-52" />
                          <Button className="h-9" disabled={busy} onClick={() => void doShortlist()}>
                            Shortlist
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <ProofProfile candidate={open} />

              {open.shortlisted && (
                <Button variant="outline"
                        onClick={() => setSponsorFor({ id: open.id, name: open.name })}>
                  Sponsor a task for {open.name}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── sponsoring ───────────────────────────────────────── */}
      <Dialog open={Boolean(sponsorFor)} onOpenChange={(v) => !v && setSponsorFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Set a task for {sponsorFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="Title — what the work is" />
            <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4}
                      placeholder="The brief. What is wrong or wanted, and what to hand back." />
            <Textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={2}
                      placeholder="What you are looking for when you review it (optional)" />
            <div className="flex gap-2">
              <Button disabled={busy || !title.trim() || !brief.trim()}
                      onClick={() => void doSponsor()}>
                {busy ? "Sending…" : "Send it"}
              </Button>
              <Button variant="ghost" onClick={() => setSponsorFor(null)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              It appears on their Daily Card. You will see the submission under Lots.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RecruiterDashboardContent;
