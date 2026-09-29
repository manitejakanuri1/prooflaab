/**
 * Step 6 async voice recording: the decisions VoiceExplainModal makes about a
 * queued job, kept free of React and the network so they can be tested
 * (voiceJob.test.ts, run with `node --test src/lib/voiceJob.test.ts`).
 */

export type JobStatus = "pending" | "processing" | "completed" | "failed";

/** What a resumable job looks like in localStorage: enough to find it again,
 * or to retry its enqueue with exactly the same metadata. Never the audio or
 * the transcript. voiceId is null until the server has confirmed the job. */
export interface StoredJob {
  voiceId: string | null;
  idempotencyKey: string;
  storagePath: string;
  durationSeconds: number | null;
}

export interface JobRow {
  id: string;
  transcription_status: JobStatus | null;
  transcript: string | null;
  transcript_segments: unknown;
  word_count: number | null;
  transcription_error: string | null;
  status: string | null;               // recorded | scored | failed (scoring)
  communication_score: number | null;
  communication_notes: string | null;
  storage_path?: string | null;
}

/** What the page should show for a row. `final` only when the server has
 * decided the score (scored or failed) - never from the word count, because a
 * short recording still gets the server's own "too little speech" result. */
export type JobView =
  | { kind: "waiting"; status: "pending" | "processing" }
  | { kind: "transcribed"; final: boolean }
  | { kind: "transcription_failed"; error: string };

export function viewOf(row: JobRow): JobView {
  const t = row.transcription_status ?? "pending";
  if (t === "failed") return { kind: "transcription_failed", error: row.transcription_error || "Could not transcribe this recording." };
  if (t !== "completed") return { kind: "waiting", status: t };
  return { kind: "transcribed", final: row.status === "scored" || row.status === "failed" };
}

/** Upgrades a StoredJob written by an older build (no durationSeconds). */
export function parseStoredJob(raw: string | null): StoredJob | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j.idempotencyKey !== "string" || typeof j.storagePath !== "string") return null;
    return {
      voiceId: typeof j.voiceId === "string" ? j.voiceId : null,
      idempotencyKey: j.idempotencyKey,
      storagePath: j.storagePath,
      durationSeconds: typeof j.durationSeconds === "number" ? j.durationSeconds : null,
    };
  } catch {
    return null;
  }
}

/** The enqueue request, identical for the first call and every retry. */
export function enqueueBody(job: StoredJob, taskId: string | null | undefined, proofId: string | null | undefined) {
  return {
    storage_path: job.storagePath,
    task_id: taskId ?? null,
    proof_id: proofId ?? null,
    duration_seconds: job.durationSeconds,
    idempotency_key: job.idempotencyKey,
  };
}

/** Consecutive poll failures (a failed read, or the row not visible) before
 * the page stops and asks the student, instead of spinning forever. */
export const MAX_POLL_FAILURES = 3;

export type PollTick =
  | { ok: true; row: JobRow }
  | { ok: false; reason: "read_error" | "missing" };

/** Counts consecutive failures; any success resets the count. */
export function nextFailures(prev: number, tick: PollTick): { failures: number; giveUp: boolean } {
  if (tick.ok) return { failures: 0, giveUp: false };
  const failures = prev + 1;
  return { failures, giveUp: failures >= MAX_POLL_FAILURES };
}

/**
 * onSaved at most once per recording per stage: "transcribed" (the transcript
 * exists - it now appears in the build-log) and "final" (the server's score
 * is decided). Repeated or overlapping poll ticks, a reopen, or a resume never
 * report the same stage twice.
 */
export class SavedNotifier {
  private seen = new Set<string>();
  private readonly onSaved: (() => void) | undefined;
  constructor(onSaved: (() => void) | undefined) { this.onSaved = onSaved; }
  notify(voiceId: string, stage: "transcribed" | "final"): boolean {
    const key = `${voiceId}:${stage}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.onSaved?.();
    return true;
  }
}

/** A new recording may replace a stored job only when that job is known to be
 * finished for good; anything uncertain must be resumed or explicitly abandoned. */
export function mayStartNewRecording(stored: StoredJob | null, confirmedTerminal: boolean): boolean {
  return stored === null || confirmedTerminal;
}
