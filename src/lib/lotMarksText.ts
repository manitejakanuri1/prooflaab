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
  days: { task_id: string; lot_at: string; coding_mark: number; voice_mark: number; voice_state: string; skip_no: number | null; day_total: number }[];
  week_total: number;
  skips: number;
}

export const SKIP_WARNING =
  "We noticed you are not recording your voice. Explaining your work by speaking is very important - it is how you show others what you know. From now on this week, coding without voice will not be counted. Please record.";

/** 8 -> "8", 7.1 -> "7.1": marks keep one decimal, whole marks show none. */
export function fmtMark(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

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
  if (lot.voice_closed) return "The spoken part of this Lot is closed. Your coding mark is saved.";
  if ((lot.voice_tries_left ?? 2) === 1) return "We could not use your last recording. Please check and record again - this is your last try.";
  return null;
}

