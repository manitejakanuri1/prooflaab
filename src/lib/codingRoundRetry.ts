/**
 * Rules for the coding round that follows the resume quiz, when its problems
 * could not be prepared. Kept free of React so they can be tested.
 *
 * Preparing a round costs several AI calls, and the quiz is already graded and
 * saved by then. So: the student sees what the server actually said, may try
 * again a bounded number of times with a short wait in between, and can always
 * continue to their results without the coding round. Retrying never sends the
 * quiz again.
 */
export const MAX_CODING_RETRIES = 3;
const WAIT_SECONDS = [0, 20, 60];

const GENERIC = /non-2xx|failed to (send|fetch)|networkerror|edge function/i;

/** What to show the student: the server's own words when it gave any, never the transport's. */
export function codingErrorMessage(error: unknown, body: Record<string, unknown> | null): string {
  const fromServer = typeof body?.error === "string" ? body.error.trim() : "";
  if (fromServer) return fromServer.slice(0, 300);
  const own = error instanceof Error ? error.message.trim() : "";
  if (own && !GENERIC.test(own)) return own.slice(0, 300);
  return "We could not prepare your coding problems. Your quiz score is saved.";
}

/** May the student retry, and how long must they wait first. `used` = retries already made. */
export function retryAllowance(used: number): { allowed: boolean; waitSeconds: number; left: number } {
  const n = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  const left = Math.max(0, MAX_CODING_RETRIES - n);
  return { allowed: left > 0, waitSeconds: left > 0 ? WAIT_SECONDS[Math.min(n, WAIT_SECONDS.length - 1)] : 0, left };
}
