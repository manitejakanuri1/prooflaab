import { fmtDay, pastDueIST } from "@/lib/ist";
import { of10 } from "@/lib/lotMarks";
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
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight, Mail, Lock, Search } from "lucide-react";
import ProofProfile from "./ProofProfile";
import { useStartupSubmissions } from "@/hooks/useStartupSubmissions";
import { passedLabel } from "@/lib/passedNote";
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
  /** F20: show only shortlisted students who have not replied yet. */
  awaitingOnly?: boolean;
}

const OUTCOMES = [
  "saved", "contacted", "sponsored", "interviewing", "offered", "hired", "passed",
] as const;
// MF-047 (migration 198): these need the student to press Accept first.
const NEEDS_YES: readonly string[] = ["interviewing", "offered", "hired"];

const RecruiterDashboardContent = ({ activeTab, onTabChange, awaitingOnly }: Props) => {
  const { toast } = useToast();
  const [home, setHome] = useState<Record<string, any> | null>(null);
  const [talent, setTalent] = useState<Candidate[] | null>(null);
  const [sortCol, setSortCol] = useState<"skills" | "work" | "speaking" | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc" | null>(null);
  const [saved, setSaved] = useState<Record<string, any>[]>([]);
  const [lots, setLots] = useState<Record<string, any>[]>([]);
  // Owner rule B: a Lot reads "Passed" only with a voice of 50+. recruiter_lots() has no voice score; the
  // company's own submissions list does.
  const [filters, setFilters] = useState<Record<string, any> | null>(null);
  // E2E 11: company_submissions refuses a company still awaiting approval (400), so ask only once verified.
  const { data: submissions = [] } = useStartupSubmissions(filters?.verified === true);
  const lotGrade = (l: (typeof lots)[number]) => {
    if (l.submission_status !== "passed") return l.submission_status === "needs_review" ? "Needs review"
      : l.submission_status === "returned" ? `Returned by ${home?.company || "the company"} for changes` : "Not passed";
    const sub = submissions.find((x) => x.task_id === l.task_id && x.student_id === l.student_id);
    return passedLabel(sub?.kind, sub?.voice_status === "scored" ? sub.voice_score : null);
  };
  // MF-094: Saved and Lots said "nothing yet" while still loading.
  const [listsReady, setListsReady] = useState(false);
  // E2E 11: a failed load used to leave the screen on its loading skeleton for good.
  const [loadFailed, setLoadFailed] = useState(false);

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
  const [lotMode, setLotMode] = useState<"coding" | "written">("written");

  const refresh = useCallback(async () => {
    try {
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
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
    setListsReady(true);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const applyFilters = async () => {
    setTalent(null);
    try {
      setTalent(await loadTalent({
        role: role === "all" ? undefined : role,
        skills: skill === "all" ? undefined : [skill],
      }));
    } catch {
      setLoadFailed(true);
    }
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
    // F10: shortlisting notifies the student at once, so ask first.
    if (!window.confirm(`Are you sure? ${open.name} will be told they were shortlisted.`)) return;
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
      const made = await sponsorLot(sponsorFor.id, title, brief, criteria, lotMode);
      toast({ title: `Lot sent to ${sponsorFor.name}`,
              description: `"${made.title}" goes on their Daily Card on their next free day (one Lot a day), checked by ${made.grading === "tests" ? "real tests" : "a marking rubric"}. You will see the submission under Submissions.` });
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

  // CO11 (migration 300): cancel a sent task the student has not handed in. The server checks it is ours and unsubmitted.
  const cancelLot = async (taskId: string, what: string) => {
    if (!window.confirm(`Cancel "${what}"? The student will no longer see it. This cannot be undone.`)) return;
    const { error } = await supabase.rpc("company_cancel_lot" as never, { _task_id: taskId } as never);
    if (error) toast({ title: "Not cancelled", description: error.message, variant: "destructive" });
    else { toast({ title: "Task cancelled", description: "The student was told." }); await refresh(); }
  };

  // MF-086: take someone off the shortlist (the company's own row; RLS allows only that).
  const removeFromShortlist = async (id: string) => {
    if (!window.confirm("Remove this candidate from your shortlist?")) return;
    const { error } = await supabase.from("recruiter_shortlists").delete().eq("id", id);
    if (error) toast({ title: "Not removed", description: error.message, variant: "destructive" });
    else { toast({ title: "Removed from shortlist" }); await refresh(); }
  };

  if (loadFailed) {
    return (
      <Card><CardContent className="pt-6">
        <h2 className="text-lg font-semibold">This page did not load</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-prose">
          We could not reach ProofLab just now. Check your internet and try again.
        </p>
        <Button className="mt-3" onClick={() => { setLoadFailed(false); void refresh(); }}>Try again</Button>
      </CardContent></Card>
    );
  }

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
  // N8: 3-state sorting: 1st click high to low, 2nd click low to high, 3rd click reset.
  const sortValue = (c: Candidate, key: "skills" | "work" | "speaking") =>
    key === "skills" ? c.skillsProven ?? 0 : key === "work" ? c.proofsVerified ?? 0 : c.communicationScore ?? -1;
  if (sortCol && sortDir) {
    visible.sort((a, b) => {
      const va = sortValue(a, sortCol);
      const vb = sortValue(b, sortCol);
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }
  const handleSortClick = (key: "skills" | "work" | "speaking") => {
    if (sortCol !== key) {
      setSortCol(key);
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortCol(null);
      setSortDir(null);
    }
  };
  const sortHead = (key: "skills" | "work" | "speaking", label: string, title?: string) => (
    <th className="pb-2 pr-3" title={title}>
      <button type="button" className={`uppercase tracking-widest hover:text-foreground ${sortCol === key ? "text-foreground font-semibold" : ""}`}
        onClick={(e) => { e.stopPropagation(); handleSortClick(key); }}>
        {label}{sortCol === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

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
              { k: "Awaiting reply", v: home.awaiting_response, go: "awaiting" },
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
                Students we suggest
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
                        {c.skills_proven} passed starting test · {c.proofs_verified} verified work
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
                  {search ? `No student matches "${search}"` : (
                    <>No candidates match. Students appear here only after they choose to be
                    discoverable, so a narrow filter on a young cohort finds nothing quickly.</>
                  )}
                </p>
              ) : (
                <table className="w-full text-sm min-w-[620px]">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      <th className="pb-2 pr-3">Candidate</th>
                      <th className="pb-2 pr-3">Role</th>
                      {sortHead("skills", "Starting test passed")}
                      {sortHead("work", "Answers passed", "Lots where the student's answer passed")}
                      {sortHead("speaking", "Voice (of 10)", "Average score of their spoken explanations, out of 10")}
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
                        <td className="py-2.5 pr-3 font-mono tabular-nums">{of10(c.communicationScore)}</td>
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
            {!listsReady ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : awaitingOnly && !saved.some((s) => !s.student_response) ? (
              <p className="text-sm text-muted-foreground">Nobody is waiting to reply. Everyone has answered.</p>
            ) : saved.length === 0 ? (
              <p className="text-sm text-muted-foreground max-w-prose">
                Nobody saved yet. Open a candidate from Talent and shortlist them — they are
                told, and choose whether to share their contact details.
              </p>
            ) : (
              <div>
                {awaitingOnly && (
                  <p className="text-xs text-muted-foreground mb-2">
                    Showing only students who have not replied yet.{" "}
                    <button type="button" className="underline text-primary" onClick={() => onTabChange?.("shortlist")}>
                      Show everyone
                    </button>
                  </p>
                )}
                {saved.filter((s) => !awaitingOnly || !s.student_response).map((s) => (
                  <div key={s.id} className="py-3 border-b last:border-b-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <button className="text-sm font-medium hover:underline"
                              onClick={() => void openProfile(s.student_id)}>
                        {/* MF-026: the student's name (from Talent); a student no longer listed stays "Open candidate" */}
                        {talent.find((c) => c.id === s.student_id)?.name ?? "Open candidate"}
                      </button>
                      <Badge variant="outline" className="text-[10px] font-normal">{s.stage}</Badge>
                      {s.student_response === "accepted" && (
                        <Badge className="text-[10px] font-normal bg-verified/15 text-verified hover:bg-verified/15">
                          accepted
                        </Badge>
                      )}
                      {s.student_response === "declined" && (
                        <Badge variant="outline" className="text-[10px] font-normal">declined</Badge>
                      )}
                      {!s.student_response && (
                        <span className="text-xs text-muted-foreground">Waiting for student to accept</span>
                      )}
                    </div>
                    {s.note && <p className="text-sm text-muted-foreground mt-1">{s.note}</p>}

                    <div className="mt-2 flex gap-2 flex-wrap">
                      <Select value={s.stage} onValueChange={(v) => void setStage(s.student_id, v)}>
                        <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {OUTCOMES.map((o) => (
                            <SelectItem key={o} value={o}
                                        disabled={s.student_response !== "accepted" && NEEDS_YES.includes(o)}>{o}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Assigned-work test item 7: every button names its candidate.
                          F21: a task only after the student accepts (company-lot and migration 370 refuse it too). */}
                      <Button size="sm" variant="outline" className="h-8" disabled={s.student_response !== "accepted"}
                              onClick={() => setSponsorFor({ id: s.student_id, name: talent.find((c) => c.id === s.student_id)?.name ?? "this candidate" })}>
                        Send a task to {talent.find((c) => c.id === s.student_id)?.name ?? "this candidate"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-muted-foreground"
                              onClick={() => void removeFromShortlist(s.id)}>
                        Remove
                      </Button>
                    </div>
                    {s.student_response !== "accepted" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {s.student_response === "declined"
                          ? `${talent.find((c) => c.id === s.student_id)?.name ?? "This candidate"} declined - you cannot send them a task.`
                          : `Waiting for ${talent.find((c) => c.id === s.student_id)?.name ?? "this candidate"} to accept - you can send a task once they accept.`}
                      </p>
                    )}
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
            {!listsReady ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : lots.length === 0 ? (
              <p className="text-sm text-muted-foreground max-w-prose">
                No sponsored work yet. You can only send a task to a student on your shortlist.
                This keeps students safe from unwanted work: only companies that picked them can
                set them a task. Shortlist a candidate in Talent, then press "Send a task" in
                Hiring, Shortlist — it lands on their Daily Card on their next free day.
              </p>
            ) : (
              <>
              <p className="text-xs text-muted-foreground mb-3">
                You can only send a task to a student on your shortlist. This keeps students safe from unwanted work.
              </p>
              <table className="w-full text-sm min-w-[620px]">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="pb-2 pr-3">Task</th><th className="pb-2 pr-3">Candidate</th>
                    <th className="pb-2 pr-3">Due</th><th className="pb-2 pr-3">Submitted</th>
                    <th className="pb-2 pr-3">Stage</th><th className="pb-2"><span className="sr-only">Actions</span></th>
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
                        {/* E2E O5: India date, as the student sees it */}
                        {l.due_date ? fmtDay(String(l.due_date)) : ""}
                      </td>
                      <td className="py-2.5 pr-3">
                        {/* recruiter_lots() reads task_submissions since migration 54 (it read the retired upload table, so nothing ever showed). */}
                        {l.submission_id ? (
                          <span className={lotGrade(l) === "Passed" ? "text-verified" : "text-compete"}>
                            {lotGrade(l)}
                            {l.score != null ? ` · ${of10(Number(l.score))}` : ""}
                            {l.voice_status === "scored" ? " · explained" : ""}
                          </span>
                        ) : (
                          // P6: due on an earlier India day and nothing handed in - missed, not "not yet".
                          pastDueIST(l.due_date as string | null) ? <span className="text-alert">Missed</span>
                            : <span className="text-muted-foreground">not yet</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {String(l.outcome ?? "—")}
                        </Badge>
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        {!l.submission_id && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-alert" data-testid="lot-cancel"
                                  onClick={() => void cancelLot(String(l.task_id), String(l.title))}>
                            Cancel
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
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
                      <Mail className="h-4 w-4 text-verified" />
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

              {open.shortlisted && (saved.find((s) => s.student_id === open.id)?.student_response === "accepted" ? (
                <Button variant="outline"
                        onClick={() => setSponsorFor({ id: open.id, name: open.name })}>
                  Send a task to {open.name}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {saved.find((s) => s.student_id === open.id)?.student_response === "declined"
                    ? `${open.name} declined - you cannot send them a task.`
                    : `Waiting for ${open.name} to accept - you can send a task once they accept.`}
                </p>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── sponsoring ───────────────────────────────────────── */}
      <Dialog open={Boolean(sponsorFor)} onOpenChange={(v) => !v && setSponsorFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send a task to {sponsorFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="Title — what the work is" />
            <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4}
                      placeholder="The brief. What is wrong or wanted, and what to hand back." />
            <Textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={2}
                      placeholder="What you are looking for when you review it (optional)" />
            <div className="flex gap-2 text-sm">
              <span className="self-center text-muted-foreground">Checked by:</span>
              {/* Item 7: the chosen one carries a tick and aria-pressed, not only a colour. */}
              <Button type="button" size="sm" variant={lotMode === "coding" ? "default" : "outline"} aria-pressed={lotMode === "coding"}
                      onClick={() => setLotMode("coding")}>{lotMode === "coding" ? "✓ " : ""}Code + tests</Button>
              <Button type="button" size="sm" variant={lotMode === "written" ? "default" : "outline"} aria-pressed={lotMode === "written"}
                      onClick={() => setLotMode("written")}>{lotMode === "written" ? "✓ " : ""}Written answer</Button>
            </div>
            <div className="flex gap-2">
              <Button disabled={busy || !title.trim() || !brief.trim()}
                      onClick={() => void doSponsor()}>
                {busy ? "Preparing the Lot (up to a minute)…" : "Send it"}
              </Button>
              <Button variant="ghost" onClick={() => setSponsorFor(null)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              We turn your brief into a clear Lot and build its checks first; if that is not possible you are told and nothing is sent.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RecruiterDashboardContent;
