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
  /** Who and what the recording belongs to (written by this build; older
   * markers lack them). Recovery is only used in the same context, and a
   * retried enqueue re-sends exactly these. */
  studentId?: string | null;
  taskId?: string | null;
  proofId?: string | null;
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
      ...(typeof j.studentId === "string" ? { studentId: j.studentId } : {}),
      ...("taskId" in j ? { taskId: typeof j.taskId === "string" ? j.taskId : null } : {}),
      ...("proofId" in j ? { proofId: typeof j.proofId === "string" ? j.proofId : null } : {}),
    };
  } catch {
    return null;
  }
}

/** The enqueue request, identical for the first call and every retry. */
export function enqueueBody(job: StoredJob, taskId: string | null | undefined, proofId: string | null | undefined) {
  // The job's own task/proof win: a retry must describe the original recording.
  return {
    storage_path: job.storagePath,
    task_id: job.taskId !== undefined ? job.taskId : (taskId ?? null),
    proof_id: job.proofId !== undefined ? job.proofId : (proofId ?? null),
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

/** Who and what a recording is for. Null means "none" (never "unknown"). */
export interface RecordingContext {
  studentId: string;
  taskId: string | null;
  proofId: string | null;
}

export function recordingContext(studentId: string, taskId?: string | null, proofId?: string | null): RecordingContext {
  return { studentId, taskId: taskId ?? null, proofId: proofId ?? null };
}

/** The recovery-marker key AND the page-wide upload slot for one context:
 * student, task and proof together, nulls included, so two proofs under the
 * same task (or a task and a proof with the same id) never share a slot. */
export function slotKey(ctx: RecordingContext): string {
  return `pl.voiceJob.v2:${JSON.stringify([ctx.studentId, ctx.taskId, ctx.proofId])}`;
}

/** The key older builds used: `taskId ?? proofId`, so every proof under one
 * task shared it. Read only for backward-compatible recovery; never written. */
export function legacySlotKey(ctx: RecordingContext): string {
  return `pl.voiceJob.${ctx.studentId}.${ctx.taskId ?? ctx.proofId ?? "general"}`;
}

/**
 * Whose recording a stored job is. A marker that carries all three fields
 * (every marker this build writes) decides by itself: "match" or "other". An
 * older marker without them is "unknown" - its key and its storage path
 * (`<student>/<time>-explain.webm`) do not prove which task/proof it was for,
 * so it must be checked against the server before it is used here.
 */
export function jobMatchesContext(job: StoredJob, ctx: RecordingContext): "match" | "other" | "unknown" {
  if (job.studentId !== undefined && job.studentId !== ctx.studentId) return "other";
  if (job.studentId === undefined || job.taskId === undefined || job.proofId === undefined) return "unknown";
  return job.taskId === ctx.taskId && job.proofId === ctx.proofId ? "match" : "other";
}

/** A row as the server holds it (RLS: only the student's own rows are visible). */
export interface OwnerRow { id: string; student_id: string; task_id: string | null; proof_id: string | null }

/**
 * An older marker, checked against the server's own row for it (found by its
 * voiceId, or by its idempotency key when the enqueue answer was never seen).
 *  - `undefined`: the check itself failed           -> unresolved, try again later
 *  - `null`:      no such row                        -> unresolved; the student may
 *                 explicitly attach it here only if the row was looked up by key
 *                 (the job never reached the server, so nothing else owns it)
 *  - a row:       it decides - "ours" or "elsewhere"
 * Never a silent guess: an unresolved marker is kept, not overwritten or deleted.
 */
export type LegacyVerdict =
  | { kind: "ours"; job: StoredJob }
  | { kind: "elsewhere" }
  | { kind: "unresolved"; canAttach: boolean };

export function classifyLegacy(
  legacy: StoredJob, ctx: RecordingContext, row: OwnerRow | null | undefined,
): LegacyVerdict {
  if (row === undefined) return { kind: "unresolved", canAttach: false };
  if (row === null) return { kind: "unresolved", canAttach: legacy.voiceId === null };
  if (row.student_id !== ctx.studentId) return { kind: "elsewhere" };
  if ((row.task_id ?? null) !== ctx.taskId || (row.proof_id ?? null) !== ctx.proofId) return { kind: "elsewhere" };
  return { kind: "ours", job: { ...legacy, voiceId: row.id, ...ctx } };
}

/** A new recording may replace a stored job only when that job is known to be
 * finished for good; anything uncertain must be resumed or explicitly abandoned. */
export function mayStartNewRecording(stored: StoredJob | null, confirmedTerminal: boolean): boolean {
  return stored === null || confirmedTerminal;
}
