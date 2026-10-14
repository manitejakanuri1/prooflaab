/**
 * record_task_submission() reports the outcome as `status` ('passed' | 'failed' |
 * 'needs_review'); it has no `passed` field. Screens that want a yes/no read it here.
 */
export function submissionPassed(rec: { status?: unknown } | null | undefined): boolean {
  return rec?.status === "passed";
}

/**
 * A task its own student inserted through the API is never evidence (migration 103, finding S29-05).
 * tasks.inserted_by is set by a database trigger, never by the caller; null means a server path created it.
 * The database (record_task_submission) refuses the same case; this is the function's own, earlier check.
 */
export function selfAuthoredTask(task: { student_id?: unknown; inserted_by?: unknown } | null | undefined): boolean {
  return typeof task?.inserted_by === "string" && task.inserted_by !== "" && task.inserted_by === task.student_id;
}
