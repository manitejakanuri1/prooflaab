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
  /** Per-recording record (key `pl.voiceJob.v3:<recordingId>`, audit F1/F2):
   *  - stage: "recording" (audio only in the page's memory), "uploading" (sent,
   *    no answer yet), "uploaded" (the server has the file; older markers,
   *    written only after a successful upload, count as uploaded)
   *  - aside: kept by the student's choice, listed, never resumed by itself
   *  - tabId/heartbeatAt: the page handling it, and when it last said so */
  recordingId?: string;
  stage?: "recording" | "uploading" | "uploaded";
  aside?: boolean;
  /** Hidden from the kept-aside list by the student, but NOT deleted: the
   * server has not confirmed a job, so another (suspended) tab may still be
   * finishing it (audit N1). That tab's own progress brings it back. */
  dismissed?: boolean;
  tabId?: string;
  heartbeatAt?: number;
  createdAt?: number;
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

export const NOT_ENGLISH_MESSAGE = "Please record your explanation in English.";

export function viewOf(row: JobRow): JobView {
  const t = row.transcription_status ?? "pending";
  if (t === "failed") {
    // English only (migration 69): the server heard another language. Not an accent
    // judgement - Indian English is accepted. The student simply records again.
    if (row.transcription_error === "non_english") return { kind: "transcription_failed", error: NOT_ENGLISH_MESSAGE };
    return { kind: "transcription_failed", error: row.transcription_error || "Could not transcribe this recording." };
  }
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
      ...(typeof j.recordingId === "string" ? { recordingId: j.recordingId } : {}),
      ...(j.stage === "recording" || j.stage === "uploading" || j.stage === "uploaded" ? { stage: j.stage } : {}),
      ...(j.aside === true ? { aside: true } : {}),
      ...(j.dismissed === true ? { dismissed: true } : {}),
      ...(typeof j.tabId === "string" ? { tabId: j.tabId } : {}),
      ...(typeof j.heartbeatAt === "number" ? { heartbeatAt: j.heartbeatAt } : {}),
      ...(typeof j.createdAt === "number" ? { createdAt: j.createdAt } : {}),
    };
  } catch {
    return null;
  }
}

/** The enqueue request, identical for the first call and every retry. */
export function enqueueBody(job: StoredJob, taskId: string | null | undefined, proofId: string | null | undefined) {
  // The job's own task wins: a retry must describe the original recording.
  // (No proof link is sent: a recording belongs to the task's submission. `proofId` survives
  // only inside the browser's recovery markers, always null, so markers written by an
  // older build - and recordings in flight during a release - still match.)
  return {
    storage_path: job.storagePath,
    task_id: job.taskId !== undefined ? job.taskId : (taskId ?? null),
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

/** One record per recording (audit F2): two tabs, or two recordings of the
 * same work, never share - and so never overwrite - a record. */
export const MARKER_PREFIX = "pl.voiceJob.v3:";
export function markerKey(recordingId: string): string {
  return `${MARKER_PREFIX}${recordingId}`;
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
export interface OwnerRow {
  id: string;
  student_id: string;
  task_id: string | null;
  /** Not read from the server any more (the column is retired); absent = null. */
  proof_id?: string | null;
  storage_path?: string | null;
  transcription_idempotency_key?: string | null;
}

/**
 * A lookup's answer (round-6 audit): a row, genuinely no row (null), the lookup
 * failed (undefined), or "ambiguous" - more than one of the student's rows
 * matched (a file path can be reused by several rows, e.g. a re-used test file
 * or older rows whose idempotency key is null). An ambiguous answer never
 * identifies a recording.
 */
export type RowLookup = OwnerRow | null | undefined | "ambiguous";

/** 0 rows -> null, exactly 1 -> that row, 2+ -> "ambiguous", failed lookup -> undefined. */
export function pickUnique(rows: OwnerRow[] | null | undefined): RowLookup {
  if (rows === undefined || rows === null) return undefined;
  if (rows.length === 0) return null;
  return rows.length === 1 ? rows[0] : "ambiguous";
}

/**
 * Is this server row really this recording, for this work (audit F8)? The
 * row's own student/task/proof must equal the context, and its storage path
 * (and idempotency key, when the row still has one) must equal the marker's.
 * A local marker is never enough by itself: it can be stale or edited.
 */
export function rowMatchesMarker(row: OwnerRow, job: StoredJob, ctx: RecordingContext): boolean {
  if (row.student_id !== ctx.studentId) return false;
  if ((row.task_id ?? null) !== ctx.taskId || (row.proof_id ?? null) !== ctx.proofId) return false;
  if (row.storage_path != null && row.storage_path !== job.storagePath) return false;
  if (row.transcription_idempotency_key != null && row.transcription_idempotency_key !== job.idempotencyKey) return false;
  return true;
}

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
  legacy: StoredJob, ctx: RecordingContext, row: RowLookup,
): LegacyVerdict {
  if (row === undefined || row === "ambiguous") return { kind: "unresolved", canAttach: false };
  if (row === null) return { kind: "unresolved", canAttach: legacy.voiceId === null };
  // The row must really be this marker's recording (same path or key) - a row
  // found by a stale voiceId that points at some other recording decides nothing.
  const samePath = row.storage_path != null && row.storage_path === legacy.storagePath;
  const sameKey = row.transcription_idempotency_key != null && row.transcription_idempotency_key === legacy.idempotencyKey;
  if (!samePath && !sameKey) return { kind: "unresolved", canAttach: false };
  if (row.student_id !== ctx.studentId) return { kind: "elsewhere" };
  if ((row.task_id ?? null) !== ctx.taskId || (row.proof_id ?? null) !== ctx.proofId) return { kind: "elsewhere" };
  return { kind: "ours", job: { ...legacy, voiceId: row.id, ...ctx } };
}

/** A new recording may replace a stored job only when that job is known to be
 * finished for good; anything uncertain must be resumed or explicitly abandoned. */
export function mayStartNewRecording(stored: StoredJob | null, confirmedTerminal: boolean): boolean {
  return stored === null || confirmedTerminal;
}

/**
 * Which stored recording (if any) this context should pick up (audit F2): the
 * newest one for exactly this context that is not set aside and that no other
 * open page is handling. `otherPages` counts the ones another page still has.
 */
export function pickResumable<T extends { job: StoredJob }>(
  entries: T[],
  ctx: RecordingContext,
  owner: (job: StoredJob) => "this-page" | "other-page" | "nobody",
): { next: T | null; otherPages: number } {
  const mine = entries.filter((e) => !e.job.aside && jobMatchesContext(e.job, ctx) === "match");
  const otherPages = mine.filter((e) => owner(e.job) === "other-page").length;
  const free = mine
    .filter((e) => owner(e.job) !== "other-page")
    .sort((a, b) => (b.job.createdAt ?? 0) - (a.job.createdAt ?? 0));
  return { next: free[0] ?? null, otherPages };
}

/**
 * What the server's row says about a kept-aside record (audit N2).
 *  - "unknown":         the check failed or was inconclusive (never "none")
 *  - "none":            no row for this recording
 *  - "saved":           the row is this recording AND this record's own student/task/proof
 *  - "saved-elsewhere": the row is this recording (same path, or same key), but its task/proof
 *                       differ - or this older record has no task/proof to compare - so it is
 *                       saved for the work it was recorded for, not confirmed as this one
 *  - "conflict":        a row was found but is not this recording (another student, or a
 *                       different key for the same path, or neither path nor key match)
 *  - "ambiguous":       several of the student's rows share this file path, so none of them
 *                       identifies it (never "saved", never attached)
 *
 * Null key / null path rules (round-6 audit, "legacy matching"):
 *  - a row key that is set must equal the record's key; a row path that is set must equal it
 *  - a NULL key on the row (rows written by the synchronous browser path) can only be matched
 *    by the path, and a path lookup only counts when exactly ONE row uses that path
 *  - a row with neither a matching key nor a matching path never identifies the recording
 * Never "saved" from path or key alone: that could credit another proof's job.
 */
export function asideStatus(
  row: RowLookup, job: StoredJob,
): "unknown" | "none" | "ambiguous" | "saved" | "saved-elsewhere" | "conflict" {
  if (row === undefined) return "unknown";
  if (row === null) return "none";
  if (row === "ambiguous") return "ambiguous";
  if (!job.studentId || row.student_id !== job.studentId) return "conflict";
  const pathOk = row.storage_path == null || row.storage_path === job.storagePath;
  const keyOk = row.transcription_idempotency_key == null || row.transcription_idempotency_key === job.idempotencyKey;
  const identified = (row.storage_path != null && row.storage_path === job.storagePath)
    || (row.transcription_idempotency_key != null && row.transcription_idempotency_key === job.idempotencyKey);
  if (!pathOk || !keyOk || !identified) return "conflict";
  const hasContext = job.taskId !== undefined && job.proofId !== undefined;
  return hasContext && rowMatchesMarker(row, job, recordingContext(job.studentId, job.taskId, job.proofId))
    ? "saved" : "saved-elsewhere";
}

/**
 * May a kept-aside record's local details be deleted (audit N1)? Only when the
 * server has confirmed a job for this very recording. A stale or missing
 * heartbeat, an empty check, "no row", or a failed check is never enough:
 * another tab may be suspended mid-upload. Otherwise "Remove" only hides it.
 */
export function mayForgetRecord(status: ReturnType<typeof asideStatus> | undefined): boolean {
  return status === "saved" || status === "saved-elsewhere";
}
