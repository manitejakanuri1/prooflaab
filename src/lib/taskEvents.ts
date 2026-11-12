/**
 * Owner E2E S7 (12 Nov 2026): after a scored answer the dashboard still read "Not started" and "–" until a later
 * refresh, because the task window, the Daily Card and the task list each load their own copy. A task window
 * announces "a task was scored" once; the Daily Card and the task list reload when they hear it.
 */
export const TASK_SCORED = "prooflab:task-scored";

export const announceTaskScored = () => { window.dispatchEvent(new Event(TASK_SCORED)); };

export function onTaskScored(fn: () => void): () => void {
  window.addEventListener(TASK_SCORED, fn);
  return () => window.removeEventListener(TASK_SCORED, fn);
}
