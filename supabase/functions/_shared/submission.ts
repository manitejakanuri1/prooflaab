/**
 * record_task_submission() reports the outcome as `status` ('passed' | 'failed' |
 * 'needs_review'); it has no `passed` field. Screens that want a yes/no read it here.
 */
export function submissionPassed(rec: { status?: unknown } | null | undefined): boolean {
  return rec?.status === "passed";
}
