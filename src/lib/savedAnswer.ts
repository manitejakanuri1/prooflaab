/**
 * MF-020: a finished task shows the student's saved answer and result, read from the server
 * (task_submissions / voice_explanations, own rows only), not from the browser's draft.
 */
export interface SavedRow {
  code: string | null;
  passed_count: number | null;
  total_count: number | null;
  sandbox_score: number | null;
  status: string;
  created_at: string;
}

const scoreOf = (r: SavedRow) =>
  r.total_count ? (r.passed_count ?? 0) / r.total_count : (r.sandbox_score ?? 0) / 100;

/** The answer to show: the passed one, else the best score, newest on a tie. */
export function bestSaved(rows: SavedRow[]): SavedRow | null {
  return [...rows].sort((a, b) =>
    Number(b.status === "passed") - Number(a.status === "passed")
    || scoreOf(b) - scoreOf(a)
    || b.created_at.localeCompare(a.created_at))[0] ?? null;
}

/** "Your saved answer · 4 of 5 tests passed · Voice 7 / 10" */
export function savedResultLine(row: SavedRow, kind: "coding" | "written", voiceScore: number | null): string {
  const parts = ["Your saved answer"];
  parts.push(kind === "coding" && row.total_count
    ? `${row.passed_count ?? 0} of ${row.total_count} tests passed`
    : `Score ${Math.round(row.sandbox_score ?? 0)} of 100`);
  if (voiceScore != null) parts.push(`Voice ${Math.round(voiceScore / 10)} / 10`);
  return parts.join(" · ");
}
