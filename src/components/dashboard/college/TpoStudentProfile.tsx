import InfoTip from "@/components/common/InfoTip";
import { lotLine } from "@/lib/lotText";
import { fmtDay, fmtDayTime } from "@/lib/ist";
import { of10, scoreText10 } from "@/lib/lotMarks";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Bell, Users } from "lucide-react";
import { format } from "date-fns";
import StudentSectionMove from "./StudentSectionMove";
import ResendInviteButton from "./ResendInviteButton";
import FinishedWork from "../FinishedWork";
import type { FinishedWorkItem } from "@/recruiter/types";

interface Profile {
  id: string;
  full_name: string;
  roll_number: string | null;
  branch: string | null;
  cohort?: string | null;
  batch: string | null;
  email: string | null;
  phone: string | null;
  total_xp: number | null;
  joined_at: string | null;
  last_active: string | null;
  days_quiet: number;
  onboarding: {
    status: string; profile_completed: boolean;
    calibration_completed: boolean; first_task_completed: boolean;
    invited_at: string | null; onboarded_at: string | null;
  };
  /** Seven steps in order, from the rows each step writes (migration 121). */
  onboarding_steps?: { step: string; done: boolean; at: string | null; detail: string | null }[];
  squad: {
    id: string; name: string; role: string; contribution: number;
    // migration 122
    points?: number | null; rank?: number | null; my_season_points?: number;
  } | null;
  activity_30d: { event_type: string; n: number }[];
  skills: { skill: string; status: string; score: number | null; lots: number | null }[];
  tasks: { assigned: number; completed: number; voice_owed?: number; attempts?: number; failed_attempts?: number; auto_graded_passed?: number };
  voice_recordings: number;
  // migration 122: the rest of what the college and admin follow.
  streak?: { current: number; longest: number; last_active_on: string | null } | null;
  voice?: { count: number; scored: number; average_score: number | null; last_score: number | null };
  mock_interviews?: { count: number; completed: number; last_score: number | null; last_at: string | null };
  recent_work: {
    id: string; file_name: string | null; task_title: string | null;
    status: string; task_status?: string | null; ai_score: number | null;
    voice?: { status: string; reason: string | null; score: number | null } | null; submitted_at: string | null; attempts?: number; // voice: migration 320
  }[];
  interventions: { type: string; reason: string; created_at: string }[];
  error?: string;
}

interface LearningPath {
  slug: string; name: string; emoji: string;
  topics_total: number; topics_done: number; steps_done: number; last_active: string | null;
}

/** CO9 (migration 300): companies that shortlisted the student, and work they accepted. */
interface CompanyInterest {
  company: string; shortlisted_at: string; stage: string | null; student_response: string | null;
  accepted: { title: string; at: string }[];
}

interface Props {
  studentId: string | null;
  onClose: () => void;
  /** Jumps to this student's squad, on its Members tab. */
  onOpenSquad?: (squadId: string) => void;
  onChanged?: () => void;
}

const EVENT_LABEL: Record<string, string> = {
  login: "signed in",
  lot_started: "started a Lot",
  lot_submitted: "finished a Lot (answer + voice)",
  voice_recorded: "recorded an explanation",
  topic_cleared: "cleared a topic",
  proof_submitted: "submitted proof",
  skill_assessed: "was assessed",
  profile_updated: "updated their profile",
  match_participated: "played a match",
};

/**
 * The Student Operational Profile — §3.2.
 *
 * One question: is this student participating and improving? Onboarding says
 * whether they ever really started, recency says whether they are still here,
 * and skills and work say whether any of it is going anywhere.
 *
 * All of it arrives in a single call, because most of what is on this panel is
 * closed to a college by row rules. A college is entitled to it for its own
 * students, and that distinction is one a function can make and a policy on a
 * table cannot.
 */
const TpoStudentProfile = ({ studentId, onClose, onOpenSquad, onChanged }: Props) => {
  const { toast } = useToast();
  const [data, setData] = useState<Profile | null>(null);
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [companies, setCompanies] = useState<CompanyInterest[]>([]);
  const [work, setWork] = useState<FinishedWorkItem[] | "error" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // M4: answers for a student opened earlier can arrive after the next student's drawer opened.
  // Each load gets a number; an answer whose number is no longer current is thrown away.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!studentId) return;
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current;
    setData(null); setError(null); setPaths([]); setWork(null); setCompanies([]);
    const { data: res, error: err } = await supabase.rpc(
      "tpo_student_profile" as never, { _student_id: studentId } as never);
    if (!current()) return;
    if (err) { setError(err.message); return; }
    const p = res as unknown as Profile;
    if (p?.error) { setError(p.error); return; }
    setData(p);
    const { data: lp } = await supabase.rpc("tpo_student_learning" as never, { _student_id: studentId } as never);
    if (!current()) return;
    setPaths(Array.isArray(lp) ? (lp as unknown as LearningPath[]) : []);
    supabase.rpc("tpo_student_companies" as never, { _student_id: studentId } as never).then(({ data: cs }) => {
      const list = (cs as { companies?: CompanyInterest[] } | null)?.companies;
      if (current() && Array.isArray(list)) setCompanies(list);
    }, () => {});
    // Admin and the own college see every finished task: answer, voice words, recording (migration 168).
    // Assigned-work test item 6: a failed call said "Nothing finished yet" next to a passed Lot. Try twice, then say so.
    const call = () => supabase.rpc("tpo_student_work" as never, { _student_id: studentId } as never);
    let wr = await call();
    if (wr.error) wr = await call();
    if (!current()) return;
    const list = (wr.data as { work?: FinishedWorkItem[] } | null)?.work;
    setWork(wr.error ? "error" : Array.isArray(list) ? list : []);
  }, [studentId]);

  useEffect(() => { void load(); }, [load]);

  const remind = async () => {
    if (!data) return;
    setSending(true);
    const hasOpenTask = (data.tasks.assigned ?? 0) > (data.tasks.completed ?? 0);
    // E2E-3: 999 means never active - say so instead of "999 days".
    const reason = hasOpenTask ? "Has a task from the college still open"
      : data.days_quiet >= 999 ? "Has not started yet"
      : data.days_quiet >= 7 ? `No Lot tried for ${data.days_quiet} days`
      : data.onboarding.status !== "completed" ? `Onboarding not finished (${data.onboarding.status.replace("_", " ")})`
      : "A Daily Lot was not tried in the last 7 days";
    const { error: err } = await supabase.rpc("tpo_send_reminder" as never, {
      _student_id: data.id, _reason: reason,
    } as never);
    setSending(false);
    if (err) {
      toast({ title: "Reminder not sent", description: err.message, variant: "destructive" });
      return;
    }
    toast({ title: `Reminder sent to ${data.full_name}`, description: reason });
    void load();
    onChanged?.();
  };

  const hasOpenTask = Boolean(data && ((data.tasks.assigned ?? 0) > (data.tasks.completed ?? 0)));
  const behind = data && (data.days_quiet >= 7 || data.onboarding.status !== "completed" || hasOpenTask);

  return (
    <Dialog open={Boolean(studentId)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {error && <p className="text-sm text-muted-foreground py-6">{error}</p>}
        {!data && !error && <Skeleton className="h-64 w-full" />}

        {data && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 flex-wrap">
                {data.full_name}
                {data.roll_number && (
                  <span className="font-mono text-sm font-normal text-muted-foreground">
                    {data.roll_number}
                  </span>
                )}
                {data.squad ? (
                  <Button
                    size="sm" variant="outline" className="h-6 text-xs"
                    onClick={() => { onOpenSquad?.(data.squad!.id); onClose(); }}
                  >
                    <Users className="h-3 w-3 mr-1" />{data.squad.name}
                  </Button>
                ) : (
                  <Badge variant="outline" className="font-normal">Reserve</Badge>
                )}
              </DialogTitle>
            </DialogHeader>

            <p className="text-sm text-muted-foreground -mt-2">
              {[data.branch, data.cohort && `Section ${data.cohort}`, data.batch, data.email, data.phone].filter(Boolean).join(" · ")}
            </p>

            {/* MF-126: never signed in, so the 1-hour set-password link may have expired. */}
            {data.email && !data.onboarding?.onboarded_at && data.days_quiet >= 999 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Has not signed in yet.</span>
                <ResendInviteButton email={data.email} />
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { k: "Last Lot try", v: data.days_quiet >= 999 ? "none yet" : data.days_quiet === 0 ? "today" : `${data.days_quiet}d ago`, // item 4: Lot tries, not sign-ins (220)
                  hot: data.days_quiet >= 7 },
                { k: "Total XP", v: data.total_xp ?? 0 },
                // Item 6: "Lots passed" means the same as the Students list column; finished = answer + voice.
                { k: "Lots passed", v: `${data.tasks.auto_graded_passed ?? 0}/${data.tasks.assigned} · ${data.tasks.completed} finished${data.tasks.voice_owed ? ` · ${data.tasks.voice_owed} voice owed` : ""}`, // M8: migration 220
                  help: "Lots passed (the answer or code passed) / every Lot this student has been given so far - the same count as the Students list. Finished = passed and the voice is done. Each student joined on a different day, so the second number differs." },
                ...(data.streak !== undefined ? [
                  { k: "Streak", v: data.streak ? `${data.streak.current}d · best ${data.streak.longest}d` : "0d" },
                  { k: "Checks not passed", v: data.tasks.failed_attempts ?? 0, hot: (data.tasks.failed_attempts ?? 0) >= 3 },
                  { k: "Voice score", v: data.voice?.average_score != null
                      ? `${of10(data.voice.average_score)} avg · last ${of10(data.voice.last_score)}` : "none yet" },
                  { k: "Mock interviews", v: data.mock_interviews?.count
                      ? `${data.mock_interviews.completed}/${data.mock_interviews.count} · last ${of10(data.mock_interviews.last_score)}`
                      : "none yet" },
                  { k: "Squad points", v: data.squad
                      ? `${data.squad.my_season_points ?? 0} mine · squad ${data.squad.points ?? 0}${(data.squad.points ?? 0) > 0 && data.squad.rank ? ` (#${data.squad.rank})` : " (Not ranked yet)"}`
                      : "in reserve" },
                ] : []),
              ].map((c) => (
                <div key={c.k} className="rounded-lg bg-muted/50 p-3" data-testid="profile-stat">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.k}
                  </span>
                  {"help" in c && c.help ? <> <InfoTip text={c.help as string} /></> : null}
                  <div className={`font-mono text-lg font-semibold tabular-nums mt-0.5 ${
                    c.hot ? "text-alert" : ""}`}>{c.v}</div>
                </div>
              ))}
            </div>

            <StudentSectionMove studentId={data.id} onMoved={() => { void load(); onChanged?.(); }} />

            <div className="grid gap-4 sm:grid-cols-2">
              <section>
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Onboarding
                </h4>
                <div className="space-y-1.5">
                  {(data.onboarding_steps ?? [
                    { step: "Profile filled in", done: data.onboarding.profile_completed, at: null, detail: null },
                    { step: "Calibration done", done: data.onboarding.calibration_completed, at: null, detail: null },
                    { step: "First Lot submitted", done: data.onboarding.first_task_completed, at: null, detail: null },
                  ]).map((s) => (
                    <div key={s.step} className="flex items-start gap-2 text-sm" data-testid="onboarding-step">
                      <span className={s.done ? "text-verified" : "text-muted-foreground"}>
                        {s.done ? "✓" : "○"}
                      </span>
                      <span className="min-w-0">
                        <span className={s.done ? "" : "text-muted-foreground"}>{s.step}</span>
                        {s.at && (
                          <span className="font-mono text-[10px] text-muted-foreground"> · {fmtDayTime(s.at)}</span>
                        )}
                        {/* The server writes "0 questions" (alone, or before " · average …") when the list is empty. */}
                        {s.detail && s.detail.replace(/^0 questions(?: · )?/, "") &&
                          <span className="block text-xs text-muted-foreground">{scoreText10(s.detail.replace(/^0 questions(?: · )?/, ""))}</span>}
                      </span>
                    </div>
                  ))}
                  <p className="font-mono text-[10px] text-muted-foreground pt-1">
                    status: {data.onboarding.status.replace("_", " ")}
                  </p>
                </div>
              </section>

              <section>
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Activity · last 30 days
                </h4>
                {data.activity_30d.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing recorded.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.activity_30d.map((a) => (
                      <div key={a.event_type} className="flex items-baseline gap-2 text-sm">
                        <span className="font-mono tabular-nums text-primary w-6">{a.n}×</span>
                        <span className="text-muted-foreground">
                          {EVENT_LABEL[a.event_type] ?? a.event_type}
                        </span>
                      </div>
                    ))}
                    <p className="font-mono text-[10px] text-muted-foreground pt-1">
                      {data.voice_recordings} voice explanation
                      {data.voice_recordings === 1 ? "" : "s"} in total
                    </p>
                  </div>
                )}
              </section>
            </div>

            {companies.length > 0 && (
              <section data-testid="profile-companies">
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Companies
                </h4>
                <div className="space-y-1.5 text-sm">
                  {companies.map((c) => (
                    <div key={c.company + c.shortlisted_at}>
                      <p>
                        <span className="font-medium">Shortlisted by {c.company}</span>
                        <span className="text-muted-foreground"> · {fmtDay(c.shortlisted_at)}
                          {c.student_response === "accepted" ? " · student said yes" : ""}</span>
                      </p>
                      {c.accepted.map((a) => (
                        <p key={a.title + a.at} className="text-verified">Accepted by {c.company} · {fmtDay(a.at)} · "{a.title}"</p>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Skills
              </h4>
              {data.skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing assessed yet — a skill only appears once it has been tested.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.skills.map((s) => (
                    <Badge
                      key={s.skill}
                      variant={s.status === "proven" ? "default" : "outline"}
                      className={s.status === "needs_improvement"
                        ? "border-alert text-alert" : ""}
                    >
                      {s.skill}
                      <span className="ml-1.5 opacity-70 font-normal">
                        {s.status === "proven" ? "passed starting test" : s.status.replace("_", " ")}
                      </span>
                    </Badge>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Learning paths
              </h4>
              {paths.length === 0 ? (
                <p className="text-sm text-muted-foreground">Has not opened a learning path yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {paths.map((lp) => (
                    <div key={lp.slug} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-b-0">
                      <span>{lp.emoji}</span>
                      <p className="truncate">{lp.name}</p>
                      <div className="ml-auto flex items-center gap-3">
                        <span className="font-mono text-xs tabular-nums">{lp.topics_done}/{lp.topics_total} topics</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {lp.last_active ? fmtDay(lp.last_active) : "not started"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Recent work
              </h4>
              {data.recent_work.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing submitted yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.recent_work.map((w) => (
                    <div key={w.id} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-b-0">
                      <div className="min-w-0">
                        <p className="truncate">{w.task_title ?? w.file_name ?? "Submission"}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {w.submitted_at ? fmtDay(w.submitted_at) : "—"}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        {(w.attempts ?? 1) > 1 && (
                          <span className="font-mono text-[10px] text-muted-foreground">{w.attempts} tries</span>
                        )}
                        <Badge variant={w.status === "passed" ? "default" : "outline"}>
                          {/* Y1/Y2: the student's own words - "Not passed · 1.9/10 · voice not done" (lotLine). */}
                          {lotLine({ answer: w.status, mark10: w.ai_score != null ? w.ai_score / 10 : null, voice: w.voice?.status ?? null,
                                     reason: w.voice?.reason, voiceScore: w.voice?.score })}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                All passed work
              </h4>
              {work === null ? <Skeleton className="h-10 w-full" />
                : work === "error" ? <p className="text-sm text-muted-foreground">Could not load this list. Close and open the student again.</p>
                : <FinishedWork work={work} />}
            </section>

            {data.interventions.length > 0 && (
              <section>
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Interventions
                </h4>
                <div className="space-y-1">
                  {data.interventions.map((i, n) => (
                    <p key={n} className="text-xs text-muted-foreground">
                      <span className="font-mono">{fmtDayTime(i.created_at)}</span>
                      {/* Sweep M8: older reminders saved "999 days" for a student who had never started. */}
                      {" · "}{i.type}{" · "}{i.reason.replace(/No activity for 999 days/i, "had not started yet")}
                    </p>
                  ))}
                </div>
              </section>
            )}

            <div className="flex gap-2 pt-2">
              {behind && (
                <Button size="sm" disabled={sending} onClick={() => void remind()}>
                  <Bell className="h-3.5 w-3.5 mr-1.5" />
                  {sending ? "Sending…" : "Send reminder"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TpoStudentProfile;
