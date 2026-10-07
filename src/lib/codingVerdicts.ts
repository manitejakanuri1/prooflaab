/**
 * How a coding test's verdict is named on student screens. Kept here (not in
 * the components) so the mapping is unit-tested; must cover every verdict the
 * server's sandbox.ts can return.
 */
export type Verdict = "accepted" | "wrong_answer" | "runtime_error" | "compile_error" | "time_limit" | "output_limit";

/** Short text for the coding task panel. */
export const VERDICT_TEXT: Record<Verdict, string> = {
  accepted: "Passed",
  wrong_answer: "Wrong answer",
  runtime_error: "Crashed",
  compile_error: "Did not compile",
  time_limit: "Too slow",
  output_limit: "Too much output",
};

/**
 * What each outcome should teach (resume assessment).
 *
 * A single red cross for every kind of failure tells a student only that they
 * are wrong, which they can already see. Naming the failure is the difference
 * between "you are bad at this" and "you have a typo on line 4".
 */
export const VERDICT_LABEL: Record<Verdict, { title: string; hint: string }> = {
  accepted: { title: "Passed", hint: "" },
  wrong_answer: { title: "Wrong answer", hint: "It ran fine — the logic is off." },
  runtime_error: { title: "Crashed", hint: "It started, then threw. The error is below." },
  compile_error: { title: "Won't build", hint: "A syntax problem — nothing ran yet." },
  time_limit: { title: "Too slow", hint: "It may be correct, but it took too long." },
  output_limit: { title: "Too much output", hint: "Your code printed too much. Remove extra print statements and just return the answer." },
};

/** The label for a verdict; a verdict this build does not know yet never crashes the screen. */
export function verdictLabel(verdict: string): { title: string; hint: string } {
  return VERDICT_LABEL[verdict as Verdict] ?? { title: "Failed", hint: "" };
}

/** The panel text for a verdict, with the same unknown-verdict guard. */
export function verdictText(verdict: string): string {
  return VERDICT_TEXT[verdict as Verdict] ?? "Failed";
}

/**
 * The score line after Submit, e.g. "Score 80% · 1 test failed - every test must pass".
 * Since migration 91 a coding task passes only when EVERY test passes, so a failed submission
 * names the failing tests rather than a percentage that would not be enough on its own.
 */
export function submitScoreLine(r: { score: number; passed: boolean; pass_threshold: number; failed_tests?: number }): string {
  if (r.passed) return `Score ${r.score}% · Passed`;
  if (r.failed_tests && r.failed_tests > 0) {
    return `Score ${r.score}% · ${r.failed_tests} test${r.failed_tests === 1 ? "" : "s"} failed - every test must pass`;
  }
  if (r.failed_tests === 0) return `Score ${r.score}% · Not recorded as passed - submit again`;
  return `Score ${r.score}% · Needs ${r.pass_threshold}%`;
}
