import { fmtMark } from "./lotMarksText.ts";

/**
 * QA round 2 item 7 (11 Nov 2026): the task text named one word range and the checker accepted another
 * (card 150-250, box 150-800). The student is shown ONE range, the checker's, wherever the text names one.
 */
export function oneRange(text: string, words?: { min: number; max: number } | null): string {
  if (!words) return text;
  return text.replace(/\b\d{1,4}\s*(?:–|-|to)\s*\d{2,4}(\s*)words?\b/gi, (_m, sp) => `${words.min}–${words.max}${sp || " "}words`);
}

/** QA round 2 item 6: the explainer's own rule ("you are not solving the task now…") is never shown. */
export const HELPER_LEAK = /[^.!?\n]*\b(not (solving|solve) the task|making the question clear|make the question (crystal )?clear|do not give the answer)\b[^.!?\n]*[.!?]?/gi;
export const dropHelper = (text: string) => text.replace(HELPER_LEAK, "").trim();

/**
 * QA round 2 item 10: one status for a Lot everywhere (Daily Card, Lot screen, Build-log).
 * A Daily Lot is "submitted" once its best check is handed in; its mark can be under the pass line.
 */
export function lotStatusText(o: { passed: boolean; submitted: boolean; mark10?: number | null }): string {
  if (o.passed) return "Passed";
  const mark = o.mark10 != null ? ` (${fmtMark(o.mark10)}/10)` : "";
  return o.submitted ? `Submitted, not passed${mark}` : `Not passed yet${mark}`;
}

/** QA round 2 items 3 and 12: a rubric part's points as x/10 ("25 of 25" -> "10/10"). */
export const part10 = (points: number, max: number | null | undefined) =>
  max ? `${fmtMark((Number(points) / max) * 10)}/10` : `${points} pts`;

/** QA round 2 item 16: one wording for the Progress tiles - "11 tries on 9 Lots (8 passed, 3 not passed)". */
export function triesSummary(rows: { task_id: string; status: string }[]) {
  const tries = rows.length;
  const lots = new Set(rows.map((r) => r.task_id)).size;
  const passed = rows.filter((r) => r.status === "passed").length;
  const review = rows.filter((r) => r.status === "needs_review").length;
  const notPassed = tries - passed - review;
  const text = `${tries} ${tries === 1 ? "try" : "tries"} on ${lots} ${lots === 1 ? "Lot" : "Lots"} (${passed} passed, ${notPassed} not passed${review ? `, ${review} being checked` : ""})`;
  return { tries, lots, passed, review, notPassed, text };
}

/**
 * QA round 2 item 21: the one status for work handed in with the voice still owed, used on the Daily Card and
 * the Build-log. "Code passed - record your 60s explanation to finish (due today)".
 */
export function voiceOwedText(o: { coding: boolean; passed: boolean; mark10?: number | null; dueToday: boolean }): string {
  const work = o.passed ? (o.coding ? "Code passed" : "Answer passed")
    : lotStatusText({ passed: false, submitted: true, mark10: o.mark10 });
  return `${work} - record your 60s explanation to finish${o.dueToday ? " (due today)" : ""}`;
}

/** QA round 2 item 24: shown while today's Lot is not finished. */
export const CLOSES_TONIGHT = "Today's Lot closes at 11:59 PM. Do it to keep your streak.";

/**
 * QA round 2 item 25: squad points are added up once a season week ends (daily job, 05:37 IST), not after each Lot.
 * `weekEnds` is the end of the running season week (my_marks_week "season_to", migration 219).
 */
export function squadUpdateText(weekEnds: string | null | undefined, fmt: (d: Date) => string, now = new Date()): string {
  // Retest F3: the morning job runs a few minutes after the week ends; a time already past moves on a week.
  let next = weekEnds ? new Date(new Date(weekEnds).getTime() + 10 * 60_000) : null;
  while (next && next <= now) next = new Date(next.getTime() + 7 * 86_400_000);
  const when = next ? ` Next update: about ${fmt(next)}.` : "";
  return `Squad points are added up once a week, after the season week ends - not after each Lot.${when}`;
}

type WeekDay = { coding_mark: number; voice_mark: number; voice_state: string; day_total: number };

/** Retest F2 (11 Nov 2026): a Lot whose voice is still owed is not "finished"; say so instead of hiding it in a count. */
export function weekLotsText(days: WeekDay[]): string {
  const owed = days.filter((d) => d.voice_state === "open").length;
  const n = days.length;
  return owed ? `${n - owed} finished, ${owed} voice owed` : `${n} ${n === 1 ? "Lot" : "Lots"}`;
}

/** Retest F2: "5.5 + voice owed = 0 (counts when your voice is scored)" rather than a bare "5.5 + 0 = 0". */
export function weekDayText(d: WeekDay): string {
  return d.voice_state === "open" && d.day_total === 0
    ? `${fmtMark(d.coding_mark)} + voice owed = 0 (counts when your voice is scored)`
    : `${fmtMark(d.coding_mark)} + ${fmtMark(d.voice_mark)} = ${fmtMark(d.day_total)}`;
}

/** Retest G4: speech-to-text mishears words ("time in WorkSolver"); say so wherever a transcript is shown. */
export const AUTO_TRANSCRIPT_NOTE = "Auto transcript, may have errors.";
