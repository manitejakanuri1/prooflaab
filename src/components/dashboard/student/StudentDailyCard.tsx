import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Mic, Upload, Clock, Loader2, Compass, Code2, PenLine } from "lucide-react";
import UploadProofModal from "@/components/dashboard/UploadProofModal";
import VoiceExplainModal from "./VoiceExplainModal";
import SandboxTaskPanel from "./SandboxTaskPanel";
import WrittenTaskPanel from "./WrittenTaskPanel";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";

interface Lot {
  id: string;
  lot_number: number | null;
  title: string;
  description: string | null;
  code_sample: string | null;
  source_jd: string | null;
  difficulty: string | null;
  estimate_minutes: number | null;
  lot_category: string | null;
  status: string | null;
  due_date: string | null;
  sponsored_by_company: string | null;
  // stage69/70: which grading mode this Lot uses. At most one is set.
  sandbox_config_id: string | null;
  rubric_config_id: string | null;
}

/** One dot per day, coloured by what was submitted. */
interface DayMark {
  date: Date;
  kind: "technical" | "business" | "pitch" | null;
}

/** The student's current squad, or null when they are still in the reserve pool. */
interface SquadSummary {
  name: string;
  points: number | null;
  rank: number | null;
  cohort: string | null;
}

/** The small caps line above the Lot title — what kind of task this is. */
function lotLabel(lot: Lot): string {
  return lot.lot_category ?? "task";
}

/**
 * The Daily Card — the screen a student lands on.
 *
 * The design deck allows exactly two actions here: Submit and Explain.
 * Everything else on the screen is information. That is not a stylistic
 * preference — a student who opens this and sees a menu has to decide what to
 * do, and deciding is the thing this screen exists to remove.
 *
 * "Submit" now opens one of three surfaces depending on how the Lot is
 * graded: the code editor (sandbox_config_id), the written-answer panel
 * (rubric_config_id), or the file/link upload (neither) — a task carries at
 * most one grading mode, so exactly one of the three ever applies.
 */
const StudentDailyCard = () => {
  const { profile } = useStudentProfile();
  const [lot, setLot] = useState<Lot | null>(null);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState(0);
  const [lastActive, setLastActive] = useState<string | null>(null);
  const [week, setWeek] = useState<DayMark[]>([]);
  const [squad, setSquad] = useState<SquadSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [coding, setCoding] = useState(false);
  const [writing, setWriting] = useState(false);
  const [explaining, setExplaining] = useState(false);
  // "preparing" is the few seconds the very first student to reach a piece
  // of content waits while the Lot behind it is written.
  const [preparing, setPreparing] = useState(false);
  const [noContent, setNoContent] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;

    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });

    const [lotRes, streakRes, weekRes, squadRes] = await Promise.all([
      supabase.rpc("my_todays_lot"),
      supabase
        .from("student_streaks")
        .select("current_days, last_active_on")
        .eq("student_id", profile.id)
        .maybeSingle(),
      supabase
        .from("tasks")
        .select("lot_date, lot_category")
        .eq("student_id", profile.id)
        .gte("lot_date", format(monday, "yyyy-MM-dd"))
        .not("lot_date", "is", null),
      // A student with no squad row is a reserve, which is a real state rather
      // than an error - left_at is null so a past membership does not count.
      supabase
        .from("squad_members")
        .select("squads(name, points, rank, cohort)")
        .eq("student_id", profile.id)
        .is("left_at", null)
        .maybeSingle(),
    ]);

    let today = ((lotRes.data as Lot[] | null) ?? [])[0] ?? null;

    // No Lot yet: ask for one rather than telling the student to come back.
    // The nightly job makes these at ten past midnight; this is the path for
    // somebody who joined today, or whose plan changed after the job ran.
    if (!today) {
      const { data: made } = await supabase.rpc("create_my_lot" as never);
      const r = made as unknown as
        { task_id: string | null; needs_writer: boolean; reason?: string; source_content_id?: string } | null;

      if (r?.reason === "no content available") {
        setNoContent(true);
      } else if (r?.task_id) {
        // The content has never been reached by anyone, so the work behind
        // it has not been written. This is the only slow path, it happens
        // once per piece of content for the whole platform, and it rewrites
        // this card in place.
        if (r.needs_writer) {
          setPreparing(true);
          if (r.source_content_id) {
            await supabase.functions.invoke("lot-writer", { body: { source_content_id: r.source_content_id } });
          }
          setPreparing(false);
        }
        const again = await supabase.rpc("my_todays_lot");
        today = ((again.data as Lot[] | null) ?? [])[0] ?? null;
      }
    }

    setLot(today);
    setStreak(streakRes.data?.current_days ?? 0);
    setLastActive(streakRes.data?.last_active_on ?? null);
    setSquad(
      ((squadRes.data as unknown as { squads: SquadSummary | null } | null)?.squads) ?? null,
    );

    const byDay = new Map<string, DayMark["kind"]>();
    for (const row of (weekRes.data ?? []) as { lot_date: string; lot_category: string | null }[]) {
      byDay.set(row.lot_date, (row.lot_category as DayMark["kind"]) ?? "technical");
    }
    setWeek(
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(monday, i);
        return { date, kind: byDay.get(format(date, "yyyy-MM-dd")) ?? null };
      }),
    );
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { void load(); }, [load]);

  const recency = lastActive
    ? isSameDay(new Date(lastActive), new Date()) ? "active" : "idle"
    : "new";

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const openLot = () => {
    if (!lot) return;
    if (lot.sandbox_config_id) setCoding(true);
    else if (lot.rubric_config_id) setWriting(true);
    else setSubmitting(true);
  };

  return (
    <div className="space-y-5">
      {/* Title line. The second word carries the colour, as in the deck. */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-3xl font-extrabold tracking-tight">
          THE <span className="text-primary">FLOOR</span>
        </h1>
        <span className="ml-auto font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {format(new Date(), "EEE · dd MMM")}
        </span>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">
          Streak <span className="font-mono text-lg font-bold text-primary">{streak}</span> days
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              recency === "active" ? "bg-emerald-500" : recency === "idle" ? "bg-amber-500" : "bg-muted-foreground"
            }`}
          />
          recency: {recency}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] items-start">
        {/* The Lot itself: a paper work order on a dark bench. */}
        {lot ? (
          <div className="rounded-xl bg-[#f2ede1] p-5 text-[#191b1f] shadow-sm">
            <div className="flex items-center gap-3 border-b border-dashed border-[#cbc4b4] pb-3">
              <span className="font-mono text-xs font-bold tracking-widest">
                LOT {lot.lot_number ? `#${String(lot.lot_number).padStart(3, "0")}` : ""}
              </span>
              {lot.due_date && (
                <span className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-[#6b6559]">
                  <Clock className="h-3 w-3" />
                  due {format(new Date(lot.due_date), "d MMM")}
                </span>
              )}
            </div>

            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b6559]">
              {lotLabel(lot)}
              {lot.estimate_minutes ? ` · ${lot.estimate_minutes} min` : ""}
              {lot.difficulty ? ` · ${lot.difficulty}` : ""}
            </p>

            {lot.sponsored_by_company && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
                Set by {lot.sponsored_by_company}
              </span>
            )}
            <h2 className="mt-2 text-lg font-semibold leading-snug">{lot.title}</h2>
            {lot.description && <p className="mt-2 text-sm text-[#4d4a43]">{lot.description}</p>}

            {lot.code_sample && (
              <pre className="mt-3 overflow-x-auto rounded-lg bg-[#14161a] p-3 font-mono text-xs leading-relaxed text-[#d7dbe2]">
                {lot.code_sample}
              </pre>
            )}

            {/* The only two actions on this screen. */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={openLot}
                className="flex-1 min-w-36 bg-[#c8492a] text-white hover:bg-[#a83c22]"
              >
                {lot.sandbox_config_id ? (
                  <><Code2 className="mr-2 h-4 w-4" /> Solve in editor</>
                ) : lot.rubric_config_id ? (
                  <><PenLine className="mr-2 h-4 w-4" /> Write my answer</>
                ) : (
                  <><Upload className="mr-2 h-4 w-4" /> Submit fix</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setExplaining(true)}
                className="flex-1 min-w-36 border-[#c6bfae] bg-transparent text-[#191b1f] hover:bg-[#e7e1d2]"
              >
                <Mic className="mr-2 h-4 w-4" /> Record 60s explain
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center">
            {preparing ? (
              <>
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Writing today's Lot. You are the first person to reach this content — after this
                  it is instant for everyone.
                </p>
              </>
            ) : noContent ? (
              <>
                <Compass className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground max-w-prose mx-auto">
                  There is no real content to hand you a Lot from yet. Check back shortly.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No Lot for today yet. Today's work is set each morning — check back shortly.
              </p>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              This week
            </p>
            <div className="mt-3 flex justify-between">
              {week.map(({ date, kind }) => {
                const today = isSameDay(date, new Date());
                const colour =
                  kind === "technical" ? "bg-emerald-500"
                  : kind === "business" ? "bg-amber-500"
                  : kind === "pitch" ? "bg-rose-500"
                  : "bg-muted";
                return (
                  <div key={date.toISOString()} className="flex flex-1 flex-col items-center gap-1.5">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${colour} ${today ? "ring-4 ring-emerald-500/20" : ""}`}
                    />
                    <span
                      className={`font-mono text-[10px] ${today ? "font-bold text-foreground" : "text-muted-foreground"}`}
                    >
                      {format(date, "EEE")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border p-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Squad
              </p>
              {squad ? (
                <>
                  <p className="mt-1 truncate text-sm font-semibold">{squad.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {squad.cohort ? `${squad.cohort} · ` : ""}
                    {squad.points ?? 0} pts
                    {squad.rank ? ` · rank #${squad.rank}` : ""}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {profile?.college_id
                    ? "Not in a squad yet — your college places you in one."
                    : "Squads are formed inside a college. You are not linked to one yet."}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {lot && !lot.sandbox_config_id && !lot.rubric_config_id && (
        <UploadProofModal
          isOpen={submitting}
          onClose={() => setSubmitting(false)}
          taskId={lot.id}
          taskTitle={lot.title}
          onSuccess={() => { setSubmitting(false); void load(); }}
        />
      )}

      {lot && lot.sandbox_config_id && (
        <Dialog open={coding} onOpenChange={setCoding}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <SandboxTaskPanel taskId={lot.id} onCompleted={() => { setCoding(false); void load(); }} />
          </DialogContent>
        </Dialog>
      )}

      {lot && lot.rubric_config_id && (
        <Dialog open={writing} onOpenChange={setWriting}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <WrittenTaskPanel taskId={lot.id} onCompleted={() => { setWriting(false); void load(); }} />
          </DialogContent>
        </Dialog>
      )}

      {lot && explaining && profile?.id && (
        <VoiceExplainModal
          open={explaining}
          onOpenChange={setExplaining}
          studentId={profile.id}
          taskId={lot.id}
          prompt={`In your own words: how did you approach "${lot.title}"?`}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
};

export default StudentDailyCard;
