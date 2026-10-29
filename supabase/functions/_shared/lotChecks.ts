/**
 * Daily Lot checks (migration 165, owner plan 29 Oct 2026): a coding Lot has 3 checks, a written Lot 2;
 * the best check is the coding mark. After Submit (or when the last check is used) no more checks.
 * Other tasks (assigned tasks, level proofs) are not limited: lot_state answers { daily: false } for them.
 */
export type LotState = {
  daily: boolean;
  submitted?: boolean;
  checks_used?: number;
  checks_max?: number;
  checks_left?: number;
  best_mark?: number;
  [k: string]: unknown;
};

// deno-lint-ignore no-explicit-any
type Db = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

/** Why a new check is refused before anything is run or paid for, or null when it may go ahead. */
export function checkRefusal(state: LotState | null): string | null {
  if (!state?.daily) return null;
  if (state.submitted) return "You already submitted this Lot. Your best check counts.";
  if ((state.checks_left ?? 0) < 1) return "No checks left. Your best check counts.";
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
  if (!state?.daily || state.submitted || (state.checks_left ?? 0) > 0) return state;
  const { data, error } = await db.rpc("lot_submit", { _student_id: studentId, _task_id: taskId });
  if (error) throw new Error(`lot_submit failed: ${error.message}`);
  return data as LotState;
}
