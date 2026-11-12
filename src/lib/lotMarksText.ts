/**
 * Daily Lot marks (migration 165, owner plan 29 Oct 2026). A coding Lot has 3 checks, a written Lot 2;
 * the best check is the coding mark (out of 10). One good recording is the voice mark (out of 10).
 * Not a Daily Lot (assigned task, level proof): { daily: false } and the old screens apply.
 * Week 2 on (migration 166, mode "strict"): a coding Lot is checked until every test passes (checks_left null),
 * a written Lot has one check.
 */
export interface LotState {
  daily: boolean;
  kind?: "coding" | "written";
  mode?: "graded" | "strict";
  checks_used?: number;
  checks_max?: number;
  checks_left?: number | null;
  best_mark?: number;
  submitted?: boolean;
  voice_mark?: number | null;
  voice_tries_left?: number;
  voice_closed?: boolean;
  voice_state?: "scored" | "tried" | "skip" | "open";
  skips_this_week?: number;
  skip_warning?: boolean;
}

export interface WeekMarks {
  from: string;
  to: string;
  /** Retest R3 (migration 219): from/to are the calendar week (Mon-Sun, India time); season_to ends the season week. */
  season_to?: string | null;
  days: { task_id: string; lot_at: string; coding_mark: number; voice_mark: number; voice_state: string; skip_no: number | null; day_total: number }[];
  week_total: number;
  skips: number;
}

export const SKIP_WARNING =
  "We noticed you are not recording your voice. Explaining your work by speaking is very important - it is how you show others what you know. From now on this week, coding without voice will not be counted. Please record.";

/** 8 -> "8", 7.1 -> "7.1": marks keep one decimal, whole marks show none. Nothing loaded -> "–", never 0 (C2). */
export function fmtMark(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "–";
  const v = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Polish pass A1: every stored 0-100 score is shown as x/10 (72 -> "7.2/10"). Stored values never change. */
export function of10(score100: number | null | undefined): string {
  return score100 == null ? "–" : `${fmtMark(Number(score100) / 10)}/10`;
}

/** Leftover 2: a sentence the server wrote with 0-100 numbers, shown on the 10 scale. */
export function scoreText10(text: string): string {
  return text
    .replace(/\b(score|ATS|readiness)\s+(\d{1,3})(?:\/100)?(?![\d./])/gi, (_, w, n) => `${w} ${of10(Number(n))}`)
    .replace(/\b(\d{1,3})\/100\b/g, (_, n) => of10(Number(n)));
}

/** Polish pass A2: the AI's "is this talk about this work" number, in words. */
export function talkCheck(match: number | null | undefined): string {
  if (match == null) return "–";
  return match >= 80 ? "Matched" : match >= 30 ? "Partly" : "Not matched";
}

/** Polish pass B: the one plain line under each number (shown by the (i) button). */
export const SCORE_HELP = {
  // Each Lot has its own pass line; where the screen does not know it, it says so.
  answer: (passLine?: number | null) =>
    `Your answer is checked part by part. Marks earned ÷ total marks × 10. ${passLine != null
      ? `Pass is ${fmtMark(passLine / 10)}.` : "Pass is usually 7 (each Lot sets its own)."}`,
  // Week 1 of a season gives part marks for coding; from week 2 it is all or nothing (migration 166).
  code: (mode?: string | null) => mode === "graded"
    ? "Week 1: tests passed ÷ all tests × 10."
    : mode === "strict" ? "All tests pass = 10, otherwise 0."
    : "Week 1: tests passed ÷ all tests × 10. From week 2: all tests pass = 10, otherwise 0.",
  voice: "How well you showed it's your own work: what you tried, what went wrong, what you changed.",
  talk: "Is your talk about this task and the work you handed in? Matched, Partly or Not matched.",
  today: "Answer + Voice, out of 20.",
  thisWeek: "Your Today scores added up this week (up to 20 per Lot).",
  lastWeek: "Your total from last week.",
  // QA round 2 item 23: what really moves the streak (touch_streak, migration 20261103017000).
  streak: "A day counts when you finish that day's Lot on the same day: hand in your answer or code, then record "
    + "your 60-second voice and get it scored. Passing is not needed. Code that never passes, or a Lot with no "
    + "voice, does not count. Sunday is rest. Miss a day and the streak starts again from 1.",
  squad: "Squad points = every member's Today scores added up. More points wins.",
  lowVoice: "Low voice score. Next time talk about what you tried and changed.",
  squadSeason: "Squad total for the whole season so far.",
  record: "Wins–Draws–Losses.",
  share: "Your season points as a share of all members' points.",
  movement: "Change in college rank since last week.",
  seasonPoints: "Your points for the whole season so far: your Today scores added up.",
  bestWeek: "Your highest week total this season.",
} as const;

/** What the student reads after a check: submit or try again, or the final best mark. */
export function checkLine(mark: number, lot: LotState): string {
  if (lot.mode === "strict") {
    return lot.kind === "coding" && !lot.submitted
      ? "Fix the failed tests and check again. The voice part opens when every test passes."
      : `Your score is ${fmtMark(lot.best_mark)} out of 10.`;
  }
  const left = lot.checks_left ?? 0;
  if (!lot.submitted && left > 0) {
    return `Score ${fmtMark(mark)}. Submit this score, or try again? (${left} ${left === 1 ? "try" : "tries"} left - your best check counts)`;
  }
  return `Your best was ${fmtMark(lot.best_mark)} - that is your score.`;
}

/** The voice part, in one line for the recorder. */
export function voiceLine(lot: LotState): string | null {
  if (!lot.daily) return null;
  if (lot.voice_state === "scored") return `Voice mark ${fmtMark(lot.voice_mark)} out of 10 - saved.`;
  // Overnight TEST 12 Nov: a written Lot has an answer mark, not a coding mark.
  if (lot.voice_closed) return `The spoken part of this Lot is closed. Your ${lot.kind === "written" ? "answer" : "coding"} mark is saved.`;
  if ((lot.voice_tries_left ?? 2) === 1) return "We could not use your last recording. Please check and record again - this is your last try.";
  return null;
}

