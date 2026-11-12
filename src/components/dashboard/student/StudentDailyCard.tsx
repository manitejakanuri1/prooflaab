import { fmtDay, istWall } from "@/lib/ist";
import { CLOSES_TONIGHT, lotStatusText, squadUpdateText, voiceOwedText, weekLotsText } from "@/lib/lotText";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { liveStreak } from "@/lib/streak";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { onTaskScored } from "@/lib/taskEvents";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Mic, Clock, Loader2, Compass, Code2, PenLine, Map as MapIcon, CheckCircle2 } from "lucide-react";
import StudentRoadmapPage from "./StudentRoadmapPage";
import VoiceExplainModal from "./VoiceExplainModal";
import { explainIfSubmitted } from "@/lib/explainGate";
import { latestVoiceStatus, type VoiceStatus } from "@/lib/voiceStatus";
import SandboxTaskPanel, { TASK_SCREEN_CLASS } from "./SandboxTaskPanel";
import WrittenTaskPanel from "./WrittenTaskPanel";
import TaskVoicePanel from "./TaskVoicePanel";
import { SimpleQuestionShort } from "./SimpleQuestion";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { tidyTitle } from "@/lib/utils";
import { fmtMark, loadLotState, loadWeekMarks, of10, SCORE_HELP, scoreText10, SKIP_WARNING, type LotState, type WeekMarks } from "@/lib/lotMarks";
import InfoTip from "@/components/common/InfoTip";
import { LOW_SCORE, passedLabel } from "@/lib/passedNote";
import { FAST_WEEK } from "@/lib/testClock";

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
  /** Where the question came from: the source's name only, never a link. */
  source_name?: string | null;
  /** Migration 88: why this Lot was chosen, built only from stored Daily-Lot evidence. */
  why_selected?: string | null;
  lot_skills?: string[] | null;
}

/** One dot per day, coloured by the Lot's kind: filled once it is done, a ring while it is open. */
interface DayMark {
  date: Date;
  taskId: string | null;
  kind: "technical" | "business" | "pitch" | "career" | null;
  /** The work passed (completed, or pending_voice): the dot opens its Build-log entry. */
  passed: boolean;
}

/** The student's current squad, or null when they are still in the reserve pool. */
interface SquadSummary {
  name: string;
  points: number | null;
  rank: number | null;
  cohort: string | null;
  /** True when this is last season's squad (no current membership), as the Squad page shows it. */
  last?: boolean;
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
  const { toast } = useToast();
  const { profile } = useStudentProfile();
  const [lot, setLot] = useState<Lot | null>(null);
  // Best passing score on today's Lot once it is done, and whether anything was submitted on it.
  const [doneScore, setDoneScore] = useState<number | null>(null);
  const [triedLot, setTriedLot] = useState(false);
  // MF-117: the scored spoken explanation (0-100), shown on the card, not only in the popup.
  const [voiceScore, setVoiceScore] = useState<number | null>(null);
  // QA round 2 item 7: a written Lot's card shows the checker's word range, the same one the answer box checks.
  const [words, setWords] = useState<{ min: number; max: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState(0);
  const [lastActive, setLastActive] = useState<string | null>(null);
  const [week, setWeek] = useState<DayMark[]>([]);
  const [squad, setSquad] = useState<SquadSummary | null>(null);
  const [coding, setCoding] = useState(false);
  const [writing, setWriting] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [needAnswer, setNeedAnswer] = useState(false);
  const [roadmap, setRoadmap] = useState(false);
  const [taskPassed, setTaskPassed] = useState(false);
  // MF-114: the voice counts only once the server has scored it. "checking" = saved, score not back yet
  // (the student may leave); "failed" = silent / too short / off topic, so they must record again.
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const voiceSaved = voiceStatus === "checking" || voiceStatus === "scored";
  // Graded daily marks (migration 165): today's Lot marks and this week's total.
  const [lotState, setLotState] = useState<LotState | null>(null);
  const [marks, setMarks] = useState<WeekMarks | null>(null);
  // "Start this stage" inside the roadmap navigates; close the dialog when it does.
  const { pathname } = useLocation();
  useEffect(() => { setRoadmap(false); }, [pathname]);
  // "preparing" is the few seconds the very first student to reach a piece
  // of content waits while the Lot behind it is written.
  const [preparing, setPreparing] = useState(false);
  const [noContent, setNoContent] = useState(false);
  // Migration 130: Sunday is the rest day - no Lot, and the streak carries over to Monday.
  const [restDay, setRestDay] = useState(false);
  // QA week 8: an unfinished Lot from an earlier day this week (e.g. Saturday's, seen on Sunday) stays reachable.
  const [earlierOpen, setEarlierOpen] = useState<{ id: string; lot_date: string }[]>([]);
  // QA round 2 item 30: after sign-out the card unmounts while its reads are still chained; stop there
  // instead of sending more reads with no session (the 401 on voice_explanations).
  const alive = useRef(true);
  const failedLoads = useRef(0);
  useEffect(() => () => { alive.current = false; }, []);
  // Migration 184: the days off between two seasons - no Lot, the roadmap stays open.
  const [nextSeasonAt, setNextSeasonAt] = useState<string | null>(null);

  // B5: "today" on the TEST website follows the admin's test clock (migration 209); REAL uses the device date.
  const [now, setNow] = useState(() => istWall());

  const load = useCallback(async () => {
    if (!profile?.id) return;

    // Overnight TEST 12 Nov: India time, not the device's time zone (a phone set to another zone showed yesterday).
    const clock = istWall(FAST_WEEK
      ? await supabase.rpc("test_now" as never).then(({ data }) => (data ? new Date(data as string) : new Date()), () => new Date())
      : new Date());
    setNow(clock);
    const monday = startOfWeek(clock, { weekStartsOn: 1 });

    const [lotRes, streakRes, weekRes, squadRes] = await Promise.all([
      supabase.rpc("my_todays_lot"),
      supabase
        .from("student_streaks")
        .select("current_days, last_active_on")
        .eq("student_id", profile.id)
        .maybeSingle(),
      supabase
        .from("tasks")
        .select("id, lot_date, lot_category, status")
        .eq("student_id", profile.id)
        .gte("lot_date", format(addDays(monday, -6), "yyyy-MM-dd"))
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

    // Retest 3: during a deploy the calls can fail (401/5xx) for a few seconds. A failed call is not "no Lot":
    // keep the loading state and try again (5 s, up to 6 times), instead of telling the student there is none.
    if (lotRes.error) {
      if (failedLoads.current++ < 6) { setTimeout(() => { if (alive.current) void load(); }, 5_000); return; }
    } else failedLoads.current = 0;

    let today = ((lotRes.data as Lot[] | null) ?? [])[0] ?? null;

    // No Lot yet: ask for one rather than telling the student to come back.
    // The nightly job makes these at ten past midnight; this is the path for
    // somebody who joined today, or whose plan changed after the job ran.
    if (!today) {
      const { data: made } = await supabase.rpc("create_my_lot" as never);
      const r = made as unknown as
        { task_id: string | null; needs_writer: boolean; reason?: string; source_content_id?: string; next_season_at?: string } | null;

      if (r?.reason === "rest day") {
        setRestDay(true);
      } else if (r?.reason === "between seasons") {
        setNextSeasonAt(r.next_season_at ?? "");
      } else if (r?.reason === "no content available") {
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

    if (!alive.current) return;
    setLot(today);
    const [todayState, weekMarks] = await Promise.all([today ? loadLotState(today.id) : Promise.resolve(null), loadWeekMarks()]);
    setLotState(todayState);
    setMarks(weekMarks);
    if (!alive.current) return;
    if (today) {
      const { data: subs } = await supabase.from("task_submissions").select("status, sandbox_score")
        .eq("task_id", today.id);
      const rows = (subs ?? []) as { status: string; sandbox_score: number | null }[];
      setTriedLot(rows.length > 0);
      const passed = rows.filter((x) => x.status === "passed").map((x) => x.sandbox_score ?? 0);
      setDoneScore(passed.length ? Math.max(...passed) : null);
      const { data: v } = await supabase.from("voice_explanations").select("communication_score")
        .eq("student_id", profile.id).eq("task_id", today.id).eq("status", "scored").is("withdrawn_at", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      setVoiceScore((v as { communication_score: number | null } | null)?.communication_score ?? null);
      if (today.rubric_config_id) {
        const { data: rv } = await supabase.rpc("rubric_task_view" as never, { _task_id: today.id } as never);
        const r = rv as unknown as { min_words: number; max_words: number } | null;
        setWords(r ? { min: r.min_words, max: r.max_words } : null);
      } else setWords(null);
    }
    setStreak(liveStreak(streakRes.data?.current_days ?? 0, streakRes.data?.last_active_on ?? null, format(clock, "yyyy-MM-dd")));
    setLastActive(streakRes.data?.last_active_on ?? null);
    let mySquad = ((squadRes.data as unknown as { squads: SquadSummary | null } | null)?.squads) ?? null;
    if (!mySquad) {
      // Same fallback as the Squad page (E2E-4): after close_season everyone's row has left_at set.
      const { data: past } = await supabase.from("squad_members").select("squads(name, points, rank, cohort)")
        .eq("student_id", profile.id).order("left_at", { ascending: false, nullsFirst: false })
        .order("joined_at", { ascending: false }).limit(1).maybeSingle();
      const p = (past as unknown as { squads: SquadSummary | null } | null)?.squads;
      mySquad = p ? { ...p, last: true } : null;
    }
    setSquad(mySquad);

    const todayKey = format(clock, "yyyy-MM-dd");
    setEarlierOpen(((weekRes.data ?? []) as { id: string; lot_date: string; status: string | null }[])
      .filter((r) => r.lot_date < todayKey && r.status !== "completed")
      .map((r) => ({ id: r.id, lot_date: r.lot_date })));
    const byDay = new Map<string, { kind: DayMark["kind"]; passed: boolean; taskId: string | null }>();
    for (const row of (weekRes.data ?? []) as { id: string; lot_date: string; lot_category: string | null; status: string | null }[]) {
      // MF-076: a day can hold two Lots (a company Lot and the daily one); a later open row must not
      // un-fill a day whose Lot is done.
      const prev = byDay.get(row.lot_date);
      byDay.set(row.lot_date, {
        kind: prev?.kind ?? (row.lot_category as DayMark["kind"]) ?? "technical",
        passed: (prev?.passed ?? false) || row.status === "completed" || row.status === "pending_voice",
        taskId: prev?.passed ? prev.taskId : row.id,
      });
    }
    // QA round 2 item 24 / retest R3: the dots show the same 7 days as "This week" (Monday-Sunday, India time,
    // migration 219), so filled dots and the week total never disagree.
    const weekStart = weekMarks?.from ? new Date(weekMarks.from) : monday;
    setWeek(
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        const d = byDay.get(format(date, "yyyy-MM-dd"));
        return { date, kind: d?.kind ?? null, passed: d?.passed ?? false, taskId: d?.taskId ?? null };
      }),
    );
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { void load(); }, [load]);
  // QA week 8: a tab left open overnight kept showing yesterday's Lot and date. Reload when the day changes.
  useEffect(() => {
    // Sweep M1: on TEST a week lasts 10 minutes, so an open tab reloads every 2 minutes instead.
    const timer = setInterval(() => {
      if (FAST_WEEK || format(istWall(), "yyyy-MM-dd") !== format(now, "yyyy-MM-dd")) void load();
    }, FAST_WEEK ? 120_000 : 60_000);
    return () => clearInterval(timer);
  }, [load, now]);
  // MF-116: while a recording is being checked, look again every 15 s so the card shows the result
  // even when the popup was closed during the upload.
  // MF-040: the card itself also waits for the score while the Lot says "Spoken explanation required"
  // (recorded from the card's own popup, or the task screen was closed), so it turns Done by itself.
  // S7: a Lot checked from the task list below (its own window) updates this card at once.
  useEffect(() => onTaskScored(() => { void load(); }), [load]);
  useLiveRefresh(async () => {
    if (!lot || !profile?.id) return;
    if (voiceStatus !== "checking" && lot.status !== "pending_voice") return;
    const st = await latestVoiceStatus(profile.id, lot.id);
    if (voiceStatus === "checking") {
      setVoiceStatus(st);
      if (st !== "checking") await load();
    } else if (st === "scored") await load();
  }, 15_000);

  // Plain words for the streak status (item 23): the streak moved today, the voice is still owed, or nothing yet.
  const todayRow = marks?.days.find((d) => d.task_id === lot?.id);
  // Sweep S1: answer marks still waiting on their voice this week.
  const weekOwed = (marks?.days ?? []).filter((d) => d.voice_state === "open").reduce((n, d) => n + Number(d.coding_mark ?? 0), 0);
  const recency = lastActive && isSameDay(istWall(new Date(lastActive)), now) ? "active"
    : lot?.status === "pending_voice" ? "voice"
    // F5 (12 Nov 2026): today's Lot reads the same as Your Tasks - opened = "In Progress", not opened = "Not started".
    : lot?.status === "In Progress" ? "started"
    : lastActive && !lot ? "idle" : "new";

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
    setTaskPassed(false);
    setNeedAnswer(false);
    setVoiceStatus(null);
    if (lot.sandbox_config_id) setCoding(true);
    else setWriting(true); // no uploads: every other Lot is a written answer
  };

  const handleTaskFinish = () => {
    setTaskPassed(false);
    setVoiceStatus(null);
    setWriting(false);
    setCoding(false);
    void load();
  };

  // MF-042: the student may always close the task screen. The answer is saved and the card keeps
  // "Record 60s explain" until the voice is scored, so they can record later.
  const remindVoiceLater = () => toast({
    title: "Your answer is saved",
    description: "Record your 60-second explanation later with \"Record 60s explain\" on this card. The task counts as done after that.",
  });

  const handleWritingOpenChange = (open: boolean) => {
    if (!open && taskPassed && !voiceSaved) remindVoiceLater();
    setWriting(open);
    if (!open) {
      setTaskPassed(false);
      setVoiceStatus(null);
      void load();
    }
  };

  const handleCodingOpenChange = (open: boolean) => {
    if (!open && taskPassed && !voiceSaved) remindVoiceLater();
    setCoding(open);
    if (!open) {
      setTaskPassed(false);
      setVoiceStatus(null);
      void load();
    }
  };

  // The recorder beside the answer on the full-screen task page.
  const voice = lot && profile?.id
    ? (unlocked: boolean, onDone?: () => void) => (
        <TaskVoicePanel
          unlocked={unlocked}
          studentId={profile.id}
          taskId={lot.id}
          title={tidyTitle(lot.title)}
          onSaved={() => {
            setVoiceStatus("checking");
            void latestVoiceStatus(profile.id, lot.id).then(setVoiceStatus);
            void load();
          }}
          onDone={onDone ?? handleTaskFinish}
        />
      )
    : undefined;

  return (
    <div className="space-y-5">
      {/* Title line. The second word carries the colour, as in the deck. */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-3xl font-extrabold tracking-tight">
          PROOF<span className="text-primary">LAB</span>
        </h1>
        <span className="ml-auto font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {format(now, "EEE · dd MMM")}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        {/* Polish P2: "on the Roadmap" opens it, so the student does not have to hunt for the tab. */}
        Today&apos;s task: one real task a day, with its source shown. Your lessons and quizzes are on{" "}
        <button type="button" className="underline hover:text-foreground" onClick={() => setRoadmap(true)} data-testid="open-roadmap-link">
          your roadmap
        </button>.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">
          <Link to="/student/dashboard?tab=log&view=history" className="hover:underline">
            Streak <span className="font-mono text-lg font-bold text-primary">{streak}</span> {streak === 1 ? "day" : "days"}
          </Link>
          {" "}<InfoTip text={SCORE_HELP.streak} />
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              recency === "active" ? "bg-verified" : recency === "new" ? "bg-muted-foreground" : "bg-compete"
            }`}
          />
          {recency === "active" ? "Done today" : recency === "voice" ? "Voice owed today" : recency === "started" ? "In Progress" : recency === "idle" ? "Not done today" : "Not started"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] items-start">
        {/* The Lot itself: a paper work order on a dark bench. */}
        {lot ? (
          <div id="todays-lot" className="rounded-xl bg-[#f2ede1] p-5 text-[#191b1f] shadow-sm">
            <div className="flex items-center gap-3 border-b border-dashed border-[#cbc4b4] pb-3">
              <span className="font-mono text-xs font-bold tracking-widest">
                LOT {lot.lot_number ? `#${String(lot.lot_number).padStart(3, "0")}` : ""}
              </span>
              {lot.due_date && (
                <span className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-[#6b6559]">
                  <Clock className="h-3 w-3" />
                  due {fmtDay(lot.due_date)}
                </span>
              )}
            </div>

            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b6559]">
              {lotLabel(lot)}
              {lot.estimate_minutes ? ` · ${lot.estimate_minutes} min` : ""}
              {lot.difficulty ? ` · ${lot.difficulty}` : ""}
            </p>

            {lot.source_name && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b6559]">
                Source: {lot.source_name}
              </p>
            )}
            {lot.sponsored_by_company && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
                Set by {lot.sponsored_by_company}
              </span>
            )}
            <h2 className="mt-2 text-lg font-semibold leading-snug">{tidyTitle(lot.title)}</h2>
            {lot.status === "completed" && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-verified/15 px-2.5 py-1 text-xs font-semibold text-verified"
                 data-testid="lot-done">
                <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                {/* Owner 1 Nov 2026: a scored voice under 50 is a low voice score. Polish C1: no redo exists, so it says so. */}
                {/* Minor 10: a Daily Lot is "submitted", not "passed" - its mark can be low. */}
                {lotState?.daily && doneScore == null
                  ? lotStatusText({ passed: false, submitted: true, mark10: lotState.best_mark })
                  : voiceScore != null && voiceScore < LOW_SCORE
                  // Item 3 (12 Nov): a passed answer reads like the Build-log - "Answer passed · low voice score".
                  ? (lotState?.daily && doneScore == null ? "Submitted · low voice score" : passedLabel(lot.sandbox_config_id ? "code" : "written", voiceScore))
                  // Retest G3: "Done · 18.2/20", the same Today total as the box below.
                  : `Done${lotState?.daily && todayRow ? ` · ${fmtMark(todayRow.day_total)}/20` : ""}`}
                {doneScore != null ? ` · ${lot.sandbox_config_id ? "Code" : "Answer"} ${of10(doneScore)}` : ""}
                {voiceScore != null ? ` · Voice ${of10(voiceScore)}` : ""}
              </p>
            )}
            {lot.status === "completed" && voiceScore != null && voiceScore < LOW_SCORE && (
              <Link to={`/student/dashboard?tab=log&view=entries&task=${encodeURIComponent(lot.id)}`}
                    className="mt-1 block text-xs text-muted-foreground hover:underline" data-testid="low-voice-tip">
                {SCORE_HELP.lowVoice} See this Lot's result.
              </Link>
            )}
            {lot.status === "pending_voice" && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-compete/15 px-2.5 py-1 text-xs font-semibold text-compete"
                 data-testid="lot-pending-voice">
                <Mic className="h-3.5 w-3.5" />{" "}
                {/* M3: after two unusable recordings the spoken part is closed for good; say that instead of "required". */}
                {lotState?.voice_closed
                  ? `${lot.sandbox_config_id ? "Code" : "Answer"} handed in · Spoken part closed (2 recordings could not be used). Your work mark is saved.`
                  : voiceOwedText({ coding: Boolean(lot.sandbox_config_id), passed: !lotState?.daily || doneScore != null,
                                    mark10: lotState?.best_mark, dueToday: true })}
              </p>
            )}
            {lot.status !== "completed" && !lotState?.voice_closed && (
              <p className="mt-2 rounded-md border border-compete/40 bg-compete/10 px-3 py-2 text-xs font-medium text-[#191b1f]"
                 data-testid="lot-closes-tonight">
                <Clock className="mr-1 inline h-3.5 w-3.5" />{CLOSES_TONIGHT}
              </p>
            )}
            {/* Why it was chosen is written when the Lot is made, so it is only true until the first try. */}
            {lot.why_selected && !triedLot && (
              <p className="mt-2 rounded-md bg-[#efe9dc] px-3 py-2 text-xs text-[#4a463d]">
                <span className="font-semibold">Why this Lot: </span>{scoreText10(lot.why_selected)}
                {lot.lot_skills && lot.lot_skills.length > 0 && <> · Skills: {lot.lot_skills.join(", ")}</>}
              </p>
            )}
            {lot.description && (
              <div className="mt-3 text-[#2b2a26]">
                <SimpleQuestionShort taskId={lot.id} original={lot.description} words={words} />
              </div>
            )}

            {lot.code_sample && (
              <pre className="mt-3 overflow-x-auto rounded-lg bg-[#14161a] p-3 font-mono text-xs leading-relaxed text-[#d7dbe2]">
                {lot.code_sample}
              </pre>
            )}

            {/* Actions on this screen */}
            <div className="mt-4 flex flex-wrap gap-2">
              {lot.status === "pending_voice" ? (
                <>
                  {!lotState?.voice_closed && <Button
                    onClick={() => void explainIfSubmitted(lot.id, () => setExplaining(true), () => setNeedAnswer(true))}
                    className="flex-1 min-w-36 bg-[#c8492a] text-white hover:bg-[#a83c22]"
                    data-testid="lot-action-explain"
                  >
                    <Mic className="mr-2 h-4 w-4" /> Record 60s explain
                  </Button>}
                  <Button
                    variant="outline"
                    onClick={openLot}
                    className="flex-1 min-w-36 border-[#c6bfae] bg-transparent text-[#191b1f] hover:bg-[#e7e1d2]"
                  >
                    <Code2 className="mr-2 h-4 w-4" /> View my code
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={openLot}
                    className="flex-1 min-w-36 bg-[#c8492a] text-white hover:bg-[#a83c22]"
                  >
                    {lot.status === "completed" ? (
                      <><CheckCircle2 className="mr-2 h-4 w-4" /> View my answer</>
                    ) : lot.sandbox_config_id ? (
                      <><Code2 className="mr-2 h-4 w-4" /> Solve in editor</>
                    ) : (
                      <><PenLine className="mr-2 h-4 w-4" /> Write my answer</>
                    )}
                  </Button>
                  {voiceScore != null || lot.status === "completed" ? (
                    <span className="flex flex-1 min-w-36 items-center justify-center gap-1.5 rounded-md border border-verified/40 px-3 text-sm font-medium text-verified"
                          data-testid="voice-done">
                      <Mic className="h-4 w-4" /> Voice done{voiceScore != null ? `: ${of10(voiceScore)}` : ""}
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => void explainIfSubmitted(lot.id, () => setExplaining(true), () => setNeedAnswer(true))}
                      className="flex-1 min-w-36 border-[#c6bfae] bg-transparent text-[#191b1f] hover:bg-[#e7e1d2]"
                    >
                      <Mic className="mr-2 h-4 w-4" /> Record 60s explain
                    </Button>
                  )}
                </>
              )}
            </div>
            {needAnswer && (
              <p className="mt-2 text-sm font-medium text-[#a83c22]" role="status" data-testid="explain-need-answer">
                Write your answer first. Then record 60 seconds explaining it.
              </p>
            )}
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
            ) : restDay ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Sunday is your rest day. No Lot today, and your streak is safe. See you on Monday.
                </p>
                {earlierOpen.length > 0 && (
                  <div className="mt-3 space-y-2" data-testid="earlier-open-lots">
                    <p className="text-sm">You still have an unfinished Lot from this week:</p>
                    {earlierOpen.map((e) => (
                      <Button key={e.id} asChild variant="outline" size="sm">
                        <Link to={`/student/tasks/assigned?open=${e.id}`}>Open the {format(new Date(`${e.lot_date}T12:00:00`), "EEE d MMM")} Lot</Link>
                      </Button>
                    ))}
                  </div>
                )}
              </>
            ) : nextSeasonAt !== null ? (
              <p className="text-sm text-muted-foreground">
                The season is over. No Daily Lot until the next season starts
                {nextSeasonAt ? ` (${fmtDay(nextSeasonAt)})` : ""}. Keep going on your roadmap.
              </p>
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
          {lotState?.daily && (
            <div className="rounded-xl border p-4" data-testid="lot-marks">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Today&apos;s marks</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="font-mono text-lg font-bold">{(lotState.checks_used ?? 0) > 0 ? fmtMark(lotState.best_mark) : "–"}</p>
                  <p className="text-[11px] text-muted-foreground">{lotState.kind === "written" ? "Answer" : "Code"} /10{" "}
                    <InfoTip text={lotState.kind === "written" ? SCORE_HELP.answer() : SCORE_HELP.code(lotState.mode)} /></p>
                </div>
                <div>
                  <p className="font-mono text-lg font-bold">{lotState.voice_state === "scored" ? fmtMark(lotState.voice_mark) : "–"}</p>
                  <p className="text-[11px] text-muted-foreground">Voice /10 <InfoTip text={SCORE_HELP.voice} /></p>
                </div>
                <div className="cursor-pointer" title="Go to today's Lot"
                     onClick={() => document.getElementById("todays-lot")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                  <p className="font-mono text-lg font-bold text-primary">
                    {(lotState.checks_used ?? 0) === 0 && lotState.voice_state !== "scored" ? "–"
                      : fmtMark(marks?.days.find((d) => d.task_id === lot?.id)?.day_total
                        ?? (Number(lotState.best_mark ?? 0) + Number(lotState.voice_state === "scored" ? lotState.voice_mark ?? 0 : 0)))}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Today /20 <InfoTip text={SCORE_HELP.today} /></p>
                  {lotState.voice_state !== "scored" && !lotState.voice_closed && (lotState.checks_used ?? 0) > 0 && (
                    <p className="text-[10px] text-muted-foreground" data-testid="today-after-voice">counts once your voice is scored</p>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm">
                <Link to="/student/dashboard?tab=log&view=progress" className="hover:underline">
                  This week: <span className="font-mono font-bold">{fmtMark(marks?.week_total)}</span>
                  {/* Sweep S1: answer marks waiting on their voice are shown, not hidden in a 0. */}
                  {weekOwed > 0 && <span className="font-mono" data-testid="week-owed"> + {fmtMark(weekOwed)} (voice owed)</span>}
                </Link>
                <span className="text-muted-foreground" data-testid="week-lots"> · {weekLotsText(marks?.days ?? [])}</span>
                {" "}<InfoTip text={SCORE_HELP.thisWeek} />
              </p>
              {(lotState.skip_warning || (marks?.skips ?? 0) >= 2) && lotState.voice_state !== "scored" && (
                <p className="mt-3 rounded-lg border-2 border-compete bg-compete/10 p-3 text-xs font-medium" data-testid="lot-skip-warning">
                  {SKIP_WARNING}
                </p>
              )}
            </div>
          )}
          <div className="rounded-xl border p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {week[0] && format(week[0].date, "EEE") !== "Mon" ? `This season week (${format(week[0].date, "EEE")}–${format(week[6].date, "EEE")})` : "This week"}{" "}
              <span className="normal-case tracking-normal">· ● done · ○ not done yet</span>
            </p>
            <p className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-verified" /> technical</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-compete" /> business</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-alert" /> pitch</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" /> career</span>
            </p>
            <div className="mt-3 flex justify-between">
              {week.map(({ date, kind, passed, taskId }) => {
                const today = isSameDay(date, now);
                // Filled = the Lot was done; ring = it was given and is still open; grey = no Lot.
                // Full class names, so Tailwind keeps them in the build.
                const DOT = {
                  technical: ["bg-verified", "border-2 border-verified bg-transparent"],
                  business: ["bg-compete", "border-2 border-compete bg-transparent"],
                  pitch: ["bg-alert", "border-2 border-alert bg-transparent"],
                  career: ["bg-warning", "border-2 border-warning bg-transparent"],
                } as const;
                // QA round 2 item 14: filled once the Lot is submitted (pending_voice), not only once the voice is scored.
                const colour = kind && DOT[kind] ? DOT[kind][passed ? 0 : 1] : "bg-muted";
                return (
                  <Link key={date.toISOString()}
                        to={taskId && passed ? `/student/dashboard?tab=log&view=entries&task=${encodeURIComponent(taskId)}`
                          : taskId ? `/student/tasks/assigned?open=${taskId}` : "/student/dashboard?tab=log&view=history"}
                        className="flex flex-1 flex-col items-center gap-1.5 rounded hover:bg-muted/40">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${colour} ${today ? "ring-4 ring-verified/20" : ""}`}
                    />
                    <span
                      className={`font-mono text-[10px] ${today ? "font-bold text-foreground" : "text-muted-foreground"}`}
                    >
                      {format(date, "EEE")}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* The roadmap beside today's work, so the Track and the Lot are one click apart. */}
          <Button variant="outline" className="w-full justify-start" onClick={() => setRoadmap(true)}>
            <MapIcon className="mr-2 h-4 w-4" /> My roadmap
          </Button>

          <Link to="/student/dashboard?tab=squad" className="flex items-center gap-3 rounded-xl border p-4 hover:bg-muted/40">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Squad
              </p>
              {squad ? (
                <>
                  <p className="mt-1 truncate text-sm font-semibold">{squad.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {squad.last ? "Last season · " : ""}{squad.cohort ? `${squad.cohort} · ` : ""}
                    {squad.points ?? 0} squad points
                    {squad.rank && (squad.points ?? 0) > 0 ? ` · rank #${squad.rank}` : ""}
                  </p>
                  {!squad.last && (
                    <p className="mt-1 text-[11px] text-muted-foreground" data-testid="squad-update-when">
                      {squadUpdateText(marks?.season_to, (d) => format(istWall(d), "EEE d MMM, h:mm a"))}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {profile?.college_id
                    ? "Not in a squad yet — your college places you in one."
                    : "Squads are formed inside a college. You are not linked to one yet."}
                </p>
              )}
            </div>
          </Link>
        </div>
      </div>

      <Dialog open={roadmap} onOpenChange={setRoadmap}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {roadmap && <StudentRoadmapPage />}
        </DialogContent>
      </Dialog>


      {lot && lot.sandbox_config_id && (
        <Dialog open={coding} onOpenChange={handleCodingOpenChange}>
          <DialogContent className={TASK_SCREEN_CLASS}>
            <SandboxTaskPanel
              taskId={lot.id}
              voice={voice}
              onPassedChange={setTaskPassed}
              voiceSaved={voiceSaved}
              voiceStatus={voiceStatus}
              onFinish={handleTaskFinish}
              onCompleted={() => { setCoding(false); setExplaining(true); void load(); }}
            />
          </DialogContent>
        </Dialog>
      )}

      {lot && !lot.sandbox_config_id && (
        <Dialog open={writing} onOpenChange={handleWritingOpenChange}>
          <DialogContent className={TASK_SCREEN_CLASS}>
            <WrittenTaskPanel
              taskId={lot.id}
              voice={voice}
              onPassedChange={setTaskPassed}
              voiceSaved={voiceSaved}
              voiceStatus={voiceStatus}
              onFinish={handleTaskFinish}
              onCompleted={() => { setWriting(false); setExplaining(true); void load(); }}
            />
          </DialogContent>
        </Dialog>
      )}

      {lot && explaining && profile?.id && (
        <VoiceExplainModal
          open={explaining}
          onOpenChange={(op) => {
            setExplaining(op);
            if (!op) void load();
          }}
          studentId={profile.id}
          taskId={lot.id}
          prompt={`In your own words: how did you approach "${tidyTitle(lot.title)}"?`}
          onSaved={() => void load()}
          onDone={() => {
            setExplaining(false);
            void load();
          }}
        />
      )}
    </div>
  );
};

export default StudentDailyCard;
