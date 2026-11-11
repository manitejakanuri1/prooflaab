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
