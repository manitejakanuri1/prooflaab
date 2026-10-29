/**
 * Daily Lot checks (migration 165, owner plan 29 Oct 2026): a coding Lot has 3 checks, a written Lot 2;
 * the best check is the coding mark. After Submit (or when the last check is used) no more checks.
 * Other tasks (assigned tasks, level proofs) are not limited: lot_state answers { daily: false } for them.
 * From week 2 (migration 166, mode "strict") a coding Lot has unlimited checks (checks_left null) until every
 * test passes, and from the 2nd failed check one failed hidden test is shown per check (hiddenHint).
 */
export type LotState = {
  daily: boolean;
  submitted?: boolean;
  checks_used?: number;
  checks_max?: number;
  checks_left?: number | null;
  best_mark?: number;
  mode?: string;
  kind?: string;
  [k: string]: unknown;
};

// deno-lint-ignore no-explicit-any
type Db = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

/** Why a new check is refused before anything is run or paid for, or null when it may go ahead. */
export function checkRefusal(state: LotState | null): string | null {
  if (!state?.daily) return null;
  if (state.submitted) return "You already submitted this Lot. Your best check counts.";
  if (state.checks_left != null && state.checks_left < 1) return "No checks left. Your best check counts.";
  return null;
}

export async function lotState(db: Db, studentId: string, taskId: string): Promise<LotState | null> {
  const { data, error } = await db.rpc("lot_state", { _student_id: studentId, _task_id: taskId });
  if (error) throw new Error(`lot_state failed: ${error.message}`);
  return data as LotState | null;
}

/** After a check is saved: the last check submits the best one, so the recorder opens. */
export async function afterCheck(db: Db, studentId: string, taskId: string): Promise<LotState | null> {
  const state = await lotState(db, studentId, taskId);
  if (!state?.daily || state.submitted || state.checks_left == null || state.checks_left > 0) return state;
  const { data, error } = await db.rpc("lot_submit", { _student_id: studentId, _task_id: taskId });
  if (error) throw new Error(`lot_submit failed: ${error.message}`);
  return data as LotState;
}

type Row = { visible?: boolean; passed: boolean; stdin?: string; expected?: string; actual?: string; stderr?: string };

/** One failed hidden test to show after a strict check (the 2nd failed check on), a different one each check. */
export function hiddenHint(results: Row[], lot: LotState | null):
  { input: string; expected: string; got: string; error: string } | null {
  if (!lot?.daily || lot.mode !== "strict" || lot.kind !== "coding" || lot.submitted) return null;
  const used = Number(lot.checks_used ?? 0);
  const failed = results.filter((r) => r.visible === false && !r.passed);
  if (used < 2 || failed.length === 0) return null;
  const r = failed[(used - 2) % failed.length];
  return { input: r.stdin ?? "", expected: r.expected ?? "", got: r.actual ?? "", error: r.stderr ?? "" };
}
