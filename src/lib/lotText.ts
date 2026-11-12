import { fmtMark } from "./lotMarksText.ts";

/**
 * QA round 2 item 7 (11 Nov 2026): the task text named one word range and the checker accepted another
 * (card 150-250, box 150-800). The student is shown ONE range, the checker's, wherever the text names one.
 */
export function oneRange(text: string, words?: { min: number; max: number } | null): string {
  if (!words) return text;
  return text.replace(/\b\d{1,4}\s*(?:–|-|to)\s*\d{2,4}(\s*)words?\b/gi, (_m, sp) => `${words.min}–${words.max}${sp || " "}words`);
}

/**
 * Lot screen simplify (11 Nov 2026): the word range is shown once, on the marking line. A step that only
 * says it is dropped; inside another sentence the range is taken out ("a short 100-200 words explanation").
 */
const RANGE = /,?\s*(?:\b(?:and\s+)?your\s+(?:answer|response)\s+(?:is|stays|should\s+be)\s+(?:about\s+)?|\b(?:(?:in|of)\s+)?(?:about|around|roughly|approximately)\s+|\b(?:in|of)\s+)?\b\d{1,4}\s*(?:–|-|to)\s*\d{2,4}[\s-]*words?\b(?:\s+(?:in\s+)?total\b)?/gi;
export function dropWordRange(text: string): string {
  if (/^\s*(write|keep)\b[^.]*\b\d{1,4}\s*(?:–|-|to)\s*\d{2,4}[\s-]*words?\b[^.]*\.?\s*$/i.test(text)) return "";
  return text.replace(RANGE, "").replace(/\s+([.,])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/** Sweep S5: the grader joins several quotes with " | "; show each one as its own quote. */
export const quotes = (evidence: string) => evidence.split(/\s+\|\s+/).map((q) => `"${q.trim()}"`).join(" … ");

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
  if (d.voice_state === "open" && d.day_total === 0) return `${fmtMark(d.coding_mark)} + voice owed = 0 (counts when your voice is scored)`;
  // Sweep M4: "5.5 + 0 = 0" read as a sum gone wrong; a voice that does not count says so.
  if (d.day_total === 0 && Number(d.coding_mark) > 0 && d.voice_state !== "scored") return `${fmtMark(d.coding_mark)} + no counted voice = 0`;
  return `${fmtMark(d.coding_mark)} + ${fmtMark(d.voice_mark)} = ${fmtMark(d.day_total)}`;
}

/** Retest G4: speech-to-text mishears words ("time in WorkSolver"); say so wherever a transcript is shown. */
export const AUTO_TRANSCRIPT_NOTE = "Auto transcript, may have errors.";

/** Retest 5: status and flag codes in plain words ("needs_review" -> "Waiting for a person"). */
const PLAIN: Record<string, string> = {
  passed: "Passed", failed: "Not passed", needs_review: "Waiting for a person", scored: "Scored", pending: "Waiting",
  completed: "Finished", copied_answer: "Looks copied", off_topic: "Off topic", silence: "No speech heard",
  too_short: "Too short", no_audio: "No sound recorded",
};
export const plainCode = (code: string | null | undefined): string =>
  !code ? "—" : PLAIN[code] ?? code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Sweep S28 + retest 11: shown text only (stored task text is never changed) - plain quotes, and old Lots that talk
 *  about "the student" read as talking to them. */
export const tidyShown = (t: string) => t
  .replace(/\\(["'])/g, "$1")
  .replace(/\bthe (student|candidate|learner)s? (must|should|will|needs to|has to|is asked to)\b/gi, (_m, _w, v: string) =>
    `you ${({ "needs to": "need to", "has to": "have to", "is asked to": "are asked to" } as Record<string, string>)[v.toLowerCase()] ?? v.toLowerCase()}`)
  .replace(/(^|[.!?]\s+|\n)you /g, (_m, p: string) => `${p}You `);

/** Purna 12 Nov 2026 (migration 229): one copied_answer_notes() row as the college's info line. */
export interface CopiedNote {
  submission_id: string; created_at: string; task_title: string | null; lot_date: string | null;
  student_name: string | null; student_squad: string | null; other_name: string | null; other_squad: string | null;
}
export function copiedNoteText(n: CopiedNote, fmtDate: (iso: string) => string): string {
  const who = (name: string | null, squad: string | null) => `${name ?? "a student"}${squad ? ` (${squad})` : ""}`;
  const pair = n.other_name ? `${who(n.student_name, n.student_squad)} and ${who(n.other_name, n.other_squad)} wrote` : `${who(n.student_name, n.student_squad)} wrote`;
  return `Looks copied: ${pair} almost the same answer on ${n.task_title ?? "a Lot"}, ${fmtDate(n.lot_date ?? n.created_at)}.`;
}
