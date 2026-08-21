import { useCallback, useEffect, useState } from "react";
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

interface Profile {
  id: string;
  full_name: string;
  roll_number: string | null;
  branch: string | null;
  batch: string | null;
  email: string | null;
  trust_score: number | null;
  total_xp: number | null;
  joined_at: string | null;
  last_active: string | null;
  days_quiet: number;
  onboarding: {
    status: string; profile_completed: boolean;
    calibration_completed: boolean; first_task_completed: boolean;
    invited_at: string | null; onboarded_at: string | null;
  };
  squad: { id: string; name: string; role: string; contribution: number } | null;
  activity_30d: { event_type: string; n: number }[];
  skills: { skill: string; status: string; score: number | null; lots: number | null }[];
  tasks: { assigned: number; completed: number };
  voice_recordings: number;
  recent_work: {
    id: string; file_name: string | null; task_title: string | null;
    status: string; ai_score: number | null; submitted_at: string | null;
  }[];
  interventions: { type: string; reason: string; created_at: string }[];
  error?: string;
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
  lot_submitted: "submitted a Lot",
  voice_recorded: "recorded an explanation",
  topic_cleared: "cleared a topic",
  proof_submitted: "submitted proof",
  proof_verified: "had proof verified",
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
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!studentId) return;
    setData(null); setError(null);
    const { data: res, error: err } = await supabase.rpc(
      "tpo_student_profile" as never, { _student_id: studentId } as never);
    if (err) { setError(err.message); return; }
    const p = res as unknown as Profile;
    if (p?.error) { setError(p.error); return; }
    setData(p);
  }, [studentId]);

  useEffect(() => { void load(); }, [load]);

  const remind = async () => {
    if (!data) return;
    setSending(true);
    const reason = data.days_quiet >= 7
      ? `No activity for ${data.days_quiet} days`
      : `Onboarding not finished (${data.onboarding.status})`;
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

  const behind = data && (data.days_quiet >= 7 || data.onboarding.status !== "completed");

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
              {[data.branch, data.batch, data.email].filter(Boolean).join(" · ")}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { k: "Last active", v: data.days_quiet >= 999 ? "never" : `${data.days_quiet}d ago`,
                  hot: data.days_quiet >= 7 },
                { k: "Trust score", v: data.trust_score ?? "—" },
                { k: "Total XP", v: data.total_xp ?? 0 },
                { k: "Lots done", v: `${data.tasks.completed}/${data.tasks.assigned}` },
              ].map((c) => (
                <div key={c.k} className="rounded-lg bg-muted/50 p-3">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.k}
                  </span>
                  <div className={`font-mono text-lg font-semibold tabular-nums mt-0.5 ${
                    c.hot ? "text-destructive" : ""}`}>{c.v}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <section>
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Onboarding
                </h4>
                <div className="space-y-1.5">
                  {[
                    ["Profile filled in", data.onboarding.profile_completed],
                    ["Calibration done", data.onboarding.calibration_completed],
                    ["First Lot submitted", data.onboarding.first_task_completed],
                  ].map(([label, done]) => (
                    <div key={label as string} className="flex items-center gap-2 text-sm">
                      <span className={done ? "text-emerald-500" : "text-muted-foreground"}>
                        {done ? "✓" : "○"}
                      </span>
                      <span className={done ? "" : "text-muted-foreground"}>{label as string}</span>
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
                        ? "border-destructive text-destructive" : ""}
                    >
                      {s.skill}
                      <span className="ml-1.5 opacity-70 font-normal">
                        {s.status.replace("_", " ")}
                      </span>
                    </Badge>
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
                          {w.submitted_at ? format(new Date(w.submitted_at), "d MMM yyyy") : "—"}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        {w.ai_score != null && (
                          <span className="font-mono text-xs tabular-nums">{w.ai_score}</span>
                        )}
                        <Badge variant={w.status === "Verified" ? "default" : "outline"}>
                          {w.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {data.interventions.length > 0 && (
              <section>
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Interventions
                </h4>
                <div className="space-y-1">
                  {data.interventions.map((i, n) => (
                    <p key={n} className="text-xs text-muted-foreground">
                      <span className="font-mono">{format(new Date(i.created_at), "d MMM")}</span>
                      {" · "}{i.type}{" · "}{i.reason}
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
