import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mic, Square, AlertTriangle, CheckCircle2, FileDown, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { transcribeWithTimestamps, type TranscribeProgress, type TranscriptSegment } from "@/lib/transcribeAudio";
import { openMic, makeRecorder, recordingFormat } from "@/lib/recordAudio";
import RecordingPlayback from "./RecordingPlayback";
import { exportTranscriptPdf } from "@/lib/exportTranscriptPdf";
import { createBlobUrlOwner, withoutLocalAudio } from "@/lib/blobUrlOwner";
import {
  audioTooLong, createEpoch, existenceOf, exportEntry, HEARTBEAT_MS, markerBelongsTo, moveDurably, ownerOf, recordedSeconds,
  recordingClock, recordingPath, safeStore, scoreToShow, settleWithin, uploadOutcome, uploadRegistry,
} from "@/lib/voiceLifecycle";
import {
  classifyLegacy, enqueueBody, jobMatchesContext, legacySlotKey, MARKER_PREFIX, markerKey, nextFailures, parseStoredJob,
  pickResumable, recordingContext, rowMatchesMarker, SavedNotifier, slotKey, viewOf,
  type JobRow, type JobStatus, type LegacyVerdict, type OwnerRow, type PollTick, type RecordingContext, type StoredJob,
} from "@/lib/voiceJob";

const MAX_SECONDS = 60;

/**
 * Minimum words before the recording is worth scoring (synchronous path).
 * Sixty seconds of near silence is not an explanation, and sending it to be
 * graded would produce a confident score for nothing. The async path leaves
 * this decision to the server, which records its own "too little speech".
 */
const MIN_WORDS = 12;

/**
 * Step 6D, staging-only feature flag: routes recording through the queued
 * transcription pipeline (transcription-enqueue -> Cloud Tasks -> the
 * worker -> Whisper) instead of transcribing in the browser and inserting
 * the result directly. Unset (the .env.production default) keeps the exact
 * synchronous path below unchanged - this flag adds a second path, it does
 * not replace the first, until a separate production rollout is approved.
 */
const ASYNC_TRANSCRIPTION = import.meta.env.VITE_ASYNC_TRANSCRIPTION === "true";

const POLL_MS = 2500;
/** A progress check or lookup that never answers counts as a failed one. */
const CHECK_TIMEOUT_MS = 15_000;
/** An enqueue that never answers is treated like a lost answer (same key is retried). */
const ENQUEUE_TIMEOUT_MS = 30_000;
/** An upload with no answer by then is "unknown": the audio stays on this page and the student decides. */
const UPLOAD_TIMEOUT_MS = 120_000;
const BUCKET = "voice-explanations";

// ---------------------------------------------------------------------------
// Page-wide state shared by every dialog on this page (audio is never persisted)
// ---------------------------------------------------------------------------

/** This page load. Stored in each recording record it is handling (audit F2). */
const TAB_ID = crypto.randomUUID();
/** Records this page is handling right now: their heartbeat is kept fresh so
 * other tabs leave them alone; when this page goes, the heartbeat stops. */
const liveMarkers = new Set<string>();
/** Audio not yet confirmed stored on the server, by recording id. Memory only -
 * private audio is never written to browser storage; it is gone on reload. */
const pendingAudio = new Map<string, Blob>();
/** Recordings started on this page that are not finished being sent yet. */
const unsentRecordings = new Set<string>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function touchMarker(key: string, patch: Partial<StoredJob>): void {
  const job = parseStoredJob(safeStore.get(key));
  if (job) safeStore.set(key, JSON.stringify({ ...job, ...patch }));
}
function beat(): void {
  for (const k of liveMarkers) touchMarker(k, { tabId: TAB_ID, heartbeatAt: Date.now() });
}
function holdMarker(key: string): void {
  liveMarkers.add(key);
  if (!heartbeatTimer) heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
}
function releaseMarker(key: string): void {
  liveMarkers.delete(key);
  if (!liveMarkers.size && heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}
if (typeof window !== "undefined") {
  // Leaving (navigation, close, reload): this page can no longer finish what it
  // was handling, so it says so at once instead of letting other tabs wait for
  // the heartbeat to go stale. Coming back from the back/forward cache resumes it.
  window.addEventListener("pagehide", () => { for (const k of liveMarkers) touchMarker(k, { heartbeatAt: 0 }); });
  window.addEventListener("pageshow", (e) => { if (e.persisted) beat(); });
  // A recording in progress or not yet stored: the browser asks before leaving.
  window.addEventListener("beforeunload", (e) => {
    if (unsentRecordings.size || pendingAudio.size) { e.preventDefault(); e.returnValue = ""; }
  });
}

/** The account the app is signed in as right now (the identity every request is sent with). */
async function signedInAs(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** Thrown when the signed-in account is no longer the recording's owner. */
class AccountChanged extends Error {
  constructor() { super("account changed"); }
}
/** Checked immediately before every request made for a recording (audit F4):
 * a recording is only ever sent with its own owner's session. */
async function requireAccount(studentId: string | null | undefined): Promise<void> {
  if (!studentId || (await signedInAs()) !== studentId) throw new AccountChanged();
}

interface VoiceExplainModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  taskId?: string | null;
  proofId?: string | null;
  /** What they are being asked to explain — shown while the clock runs. */
  prompt: string;
  onSaved?: () => void;
}

/**
 * "uncertain" (async path only): the server may already hold this recording
 * (no answer to an upload or enqueue, or progress checks that keep failing).
 * The recovery record is kept; the student resumes it or keeps it aside.
 * "checking": an older recovery record is being checked with the server.
 * "legacy": we cannot confirm which work a record belongs to (an older build's
 * record, or a server row that does not match it); the student chooses.
 * "interrupted": a recording that confirmably never reached the server (the
 * page was closed/reloaded while recording or uploading) - said plainly.
 */
type Phase =
  | "idle" | "recording" | "transcribing" | "saving" | "queued" | "done"
  | "uncertain" | "checking" | "legacy" | "interrupted" | "error";

interface SavedResult {
  transcript: string;
  segments: TranscriptSegment[];
  score: number | null;
  notes: string | null;
  /** blob: URL of the recording just made in this tab, if any. */
  audioUrl?: string;
  /** the stored file, played through an authenticated download after a refresh. */
  storagePath?: string;
}

/**
 * One recording, fixed when it starts. Every later step - upload, recovery
 * record, enqueue, retry - uses these values, never the current props, and
 * is only ever sent with this student's own session.
 */
interface Recording {
  id: string;
  ctx: RecordingContext;
  slot: string;
  key: string;                 // its own recovery record
  path: string;                // its own storage object: <student>/<id>-explain.<ext>
  idempotencyKey: string;
  type: string;
  epoch: number;
}

/** One recorder's own microphone, buffer and meter (audit F3): a late event
 * from an older recorder only ever touches its own session. */
interface MediaSession {
  stream: MediaStream;
  recorder: MediaRecorder | null;
  chunks: BlobPart[];
  meter: AudioContext | null;
  raf: number | null;
  ended: boolean;
}

/** The file service's answer as it really arrives (integrations/google/storage.ts):
 * `statusCode` is set when the service answered, absent when it could not be reached. */
type FileResult = { data: unknown; error: { message: string; statusCode?: string } | null };

type AsideCheck = "checking" | "saved" | "can-save" | "lost" | "unknown";
interface AsideEntry { key: string; job: StoredJob }

/** Real decoded length of a recording, or null when this browser cannot tell. */
async function decodedSeconds(blob: Blob): Promise<number | null> {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    const buf = await settleWithin(ctx.decodeAudioData(await blob.arrayBuffer()), 10_000, null);
    return buf ? buf.duration : null;
  } catch {
    return null;
  } finally {
    if (ctx) void ctx.close().catch(() => {});
  }
}

const ctxOf = (job: StoredJob): RecordingContext =>
  recordingContext(job.studentId ?? "", job.taskId ?? null, job.proofId ?? null);

/**
 * Consent, asked once and remembered.
 *
 * The platform keeps a recording of the student's voice, a transcript of it and
 * a judgement about how clearly they explain things. Storing that without ever
 * asking, and with no way to take it back, is the kind of thing nobody notices
 * until a parent or a college's legal team asks about it. The wording below
 * must match what the app actually allows (checked 2026-09-29): the audio file
 * is readable only by its owner (files-service owner check); the college sees a
 * count only (tpo_student_profile.voice_recordings); ProofLab admins can read
 * the row (voice_own_read allows is_admin()); verified companies see the score
 * and notes of a discoverable student (recruiter_talent/recruiter_proof_profile),
 * never the audio; the student deletes the row and the file from Profile ->
 * Privacy (voice_own_delete + owner delete).
 */

const VoiceExplainModal = ({
  open, onOpenChange, studentId, taskId, proofId, prompt, onSaved,
}: VoiceExplainModalProps) => {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  // Consent is stored WITH the student it was answered for: another student's
  // answer (a late read, or a late "I understand") never counts here.
  const [consent, setConsent] = useState<{ student: string; value: boolean | null }>({ student: "", value: null });
  const consented = consent.student === studentId ? consent.value : null;
  const consentRef = useRef(consent);
  consentRef.current = consent;
  const consentGenRef = useRef(0);                 // bumped whenever the student or open state changes
  const [acceptingFor, setAcceptingFor] = useState<string | null>(null);
  const accepting = acceptingFor === studentId;
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [transcribeProgress, setTranscribeProgress] = useState<TranscribeProgress | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaSession | null>(null);   // the recorder this dialog is showing, if any
  const [savedResult, setSavedResult] = useState<SavedResult | null>(null);

  // The context this dialog is showing right now, and its upload slot.
  const ctx = useMemo(() => recordingContext(studentId, taskId, proofId), [studentId, taskId, proofId]);
  const slot = slotKey(ctx);
  const slotRef = useRef(slot);
  slotRef.current = slot;

  // Step 6D/6E/G1 (async path only, see ASYNC_TRANSCRIPTION above).
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [uncertainReason, setUncertainReason] = useState<string | null>(null);
  const [scoringPending, setScoringPending] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailuresRef = useRef(0);
  // In-flight work is owned by its session (epoch) and its job/slot/recording,
  // never by the component: an old request that never answers cannot block a
  // newer session, and the same recording is never saved twice.
  const checksInFlightRef = useRef(new Set<string>());   // `${epoch}:${voiceId}`
  const resumesInFlightRef = useRef(new Set<string>());  // `${epoch}:${slot}`
  const savedRecordingsRef = useRef(new Set<string>());  // Recording.id, once each, forever
  /** The recovery record this dialog is currently showing/following. */
  const activeKeyRef = useRef<string | null>(null);
  // A record we cannot confirm belongs to this work (older build, or a server row that does not match).
  const unresolvedRef = useRef<{ key: string; job: StoredJob; legacy: boolean } | null>(null);
  const [legacyCanAttach, setLegacyCanAttach] = useState(false);
  const elsewhereRef = useRef(new Set<string>());        // older markers proven to belong to other work
  const [asideList, setAsideList] = useState<AsideEntry[]>([]);
  const [asideChecks, setAsideChecks] = useState<Record<string, AsideCheck>>({});
  const [otherTabs, setOtherTabs] = useState(0);         // recordings for this work another open tab is sending
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  // onSaved once per recording per stage, however often polling reports it.
  const notifierRef = useRef<SavedNotifier | null>(null);
  if (!notifierRef.current) notifierRef.current = new SavedNotifier(() => onSavedRef.current?.());
  // The one local blob: URL of the recording made in this dialog. Revoked on a
  // failed save, a replacement, close and unmount - and always dropped from
  // savedResult at the same time, so playback then uses storagePath instead.
  const blobOwnerRef = useRef<ReturnType<typeof createBlobUrlOwner> | null>(null);
  if (!blobOwnerRef.current) blobOwnerRef.current = createBlobUrlOwner();
  // Lifecycle guards (lib/voiceLifecycle.ts). The epoch is bumped on close,
  // unmount, abandon, a context change and every new recording: an async
  // continuation from an older epoch (a late microphone grant, upload,
  // enqueue answer or poll) never touches the screen or the blob URL.
  const epochRef = useRef<ReturnType<typeof createEpoch> | null>(null);
  if (!epochRef.current) epochRef.current = createEpoch();
  const mountedRef = useRef(true);
  const openRef = useRef(open);
  openRef.current = open;
  const startingRef = useRef(false);            // one Start at a time
  const [starting, setStarting] = useState(false);
  const activePollIdRef = useRef<string | null>(null);
  const [slotBusy, setSlotBusy] = useState(false); // a recording for this slot is still in progress on this page
  const waitingForSlotRef = useRef(false);          // this dialog is waiting for that save
  const recordStartedAtRef = useRef(0);             // Date.now() when recording began
  const stopAtRef = useRef<number | null>(null);    // Date.now() when a stop was asked for
  const releaseLocalAudio = useCallback(() => {
    blobOwnerRef.current?.release();
    setSavedResult((prev) => withoutLocalAudio(prev));
  }, []);

  /** Stops one recorder session's own microphone and meter; clears the
   * dialog's reference only if it still points at this session. */
  const endMedia = useCallback((m: MediaSession) => {
    m.ended = true;
    if (m.raf !== null) cancelAnimationFrame(m.raf);
    m.raf = null;
    m.stream.getTracks().forEach((t) => t.stop());
    if (m.meter) void m.meter.close().catch(() => {});
    m.meter = null;
    if (mediaRef.current === m) mediaRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current?.next();
      if (mediaRef.current) endMedia(mediaRef.current);
      blobOwnerRef.current?.release();
    };
  }, [endMedia]);

  // Browser storage, with in-memory overrides when writing or removing is blocked.
  const readJob = useCallback((key: string): StoredJob | null => parseStoredJob(safeStore.get(key)), []);
  const writeJob = useCallback((key: string, job: StoredJob | null): boolean => (
    job ? safeStore.set(key, JSON.stringify(job)) : safeStore.remove(key)
  ), []);
  /** Updates a record only while it is still the same recording's (never
   * resurrects a removed one, never overwrites another). */
  const updateJobIfSame = useCallback((key: string, job: StoredJob) => {
    if (readJob(key)?.idempotencyKey === job.idempotencyKey) writeJob(key, job);
  }, [readJob, writeJob]);
  /** Clears the record only if it still belongs to this recording. */
  const clearJobFor = useCallback((key: string, voiceId: string) => {
    if (markerBelongsTo(readJob(key)?.voiceId, voiceId)) writeJob(key, null);
  }, [readJob, writeJob]);

  /** Every per-recording record in this browser. */
  const listMarkers = useCallback((): AsideEntry[] => (
    safeStore.keys(MARKER_PREFIX)
      .map((key) => ({ key, job: readJob(key) }))
      .filter((e): e is AsideEntry => e.job !== null)
  ), [readJob]);

  const refreshAside = useCallback(() => {
    setAsideList(listMarkers().filter((e) => e.job.aside && e.job.studentId === studentId));
  }, [listMarkers, studentId]);

  /**
   * Moves a record to its per-recording key (audit F1). The old key is deleted
   * only once the new record is durably stored; otherwise the old one stays in
   * storage (hidden on this page only), so a reload can never lose both.
   */
  const moveRecord = useCallback((oldKey: string, job: StoredJob): string => {
    const id = job.recordingId ?? job.idempotencyKey;
    const key = markerKey(id);
    const record: StoredJob = { stage: "uploaded", createdAt: Date.now(), ...job, recordingId: id };
    moveDurably(safeStore, oldKey, key, JSON.stringify(record));
    return key;
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    activePollIdRef.current = null;
  }, []);

  /** Recovery details are kept; the student chooses resume or keep aside. */
  const becomeUncertain = useCallback((reason: string) => {
    stopPolling();
    setUncertainReason(reason);
    setPhase("uncertain");
  }, [stopPolling]);

  /** A record we cannot confirm belongs to this work: nothing is shown, attached or deleted. */
  const showUnresolved = useCallback((key: string, job: StoredJob, legacy: boolean, canAttach: boolean) => {
    stopPolling();
    unresolvedRef.current = { key, job, legacy };
    setLegacyCanAttach(canAttach);
    setPhase("legacy");
  }, [stopPolling]);

  /** One check of the job's current row. Reads only this student's own row
   * (RLS), sent only with the record owner's session, and shown only if the
   * row really is this recording for this work (audit F8). A failed,
   * timed-out or empty read counts as a failure; after MAX_POLL_FAILURES in a
   * row the page stops and asks, instead of spinning forever. */
  const checkJob = useCallback(async (voiceId: string, epoch: number, key: string, job: StoredJob) => {
    const flight = `${epoch}:${voiceId}`;
    if (checksInFlightRef.current.has(flight)) return;    // one check at a time per job and session
    checksInFlightRef.current.add(flight);
    try {
      if ((await signedInAs()) !== job.studentId) return;   // never read as another account
      // types.ts predates migrations 41-45 (transcription_status and friends).
      const res = await settleWithin(
        supabase
          .from("voice_explanations")
          .select("id, student_id, task_id, proof_id, transcription_idempotency_key, transcription_status, transcript, transcript_segments, word_count, transcription_error, status, communication_score, communication_notes, storage_path")
          .eq("id", voiceId)
          .maybeSingle()
          .then((r) => r as unknown as { data: (JobRow & OwnerRow) | null; error: unknown }, (e) => ({ data: null, error: e })),
        CHECK_TIMEOUT_MS, { data: null, error: "timeout" },
      );

      // A late answer after close/abandon/another recording: ignore entirely.
      if (!epochRef.current!.isCurrent(epoch) || activePollIdRef.current !== voiceId || !mountedRef.current) return;

      if (res.data && !rowMatchesMarker(res.data, job, ctxOf(job))) {
        showUnresolved(key, job, false, false);
        return;
      }
      const failReason: "read_error" | "missing" | null = res.error ? "read_error" : !res.data ? "missing" : null;
      const tick: PollTick = failReason ? { ok: false, reason: failReason } : { ok: true, row: res.data as JobRow };
      const { failures, giveUp } = nextFailures(pollFailuresRef.current, tick);
      pollFailuresRef.current = failures;
      if (failReason) {
        if (giveUp) {
          becomeUncertain(failReason === "missing"
            ? "We can't see your recording's progress right now. It may still be processing."
            : "We couldn't check on your recording (connection problem). It may still be processing.");
        }
        return;
      }

      const row = res.data as JobRow;
      const view = viewOf(row);
      setJobStatus((row.transcription_status ?? "pending") as JobStatus);

      if (view.kind === "waiting") {
        setPhase("queued");
        return;
      }
      if (view.kind === "transcription_failed") {
        // Confirmed final by the server: now a new recording is safe.
        stopPolling();
        clearJobFor(key, voiceId);
        setJobError(view.error);
        setPhase("error");
        return;
      }

      // Transcribed. Scoring is started by the server (transcription-worker,
      // or transcription-reap), never by this page, and only the server's
      // own status says when it is final - a short recording included, which
      // gets the server's "too little speech" result, not a guess from here.
      setScoringPending(!view.final);
      if (view.final) {
        stopPolling();
        clearJobFor(key, voiceId);
      }
      setSavedResult((prev) => ({
        transcript: row.transcript ?? "",
        segments: (row.transcript_segments as TranscriptSegment[] | null) ?? [],
        // Only a server status of 'scored' permits a number (shown and exported).
        score: scoreToShow(row.status, row.communication_score),
        notes: row.communication_notes ?? null,
        audioUrl: prev?.audioUrl,
        storagePath: row.storage_path ?? prev?.storagePath,
      }));
      setPhase("done");
      notifierRef.current?.notify(voiceId, "transcribed");
      if (view.final) notifierRef.current?.notify(voiceId, "final");
    } finally {
      checksInFlightRef.current.delete(flight);
    }
  }, [becomeUncertain, stopPolling, clearJobFor, showUnresolved]);

  /** This student's own row (RLS), found by id, idempotency key or storage
   * path, with who/what it belongs to. `undefined`: the lookup failed or
   * timed out, or the signed-in account is not `owner` (unknown). `null`:
   * genuinely not there. */
  const findOwnRow = useCallback(async (
    owner: string | null | undefined,
    column: "id" | "transcription_idempotency_key" | "storage_path", value: string,
  ): Promise<OwnerRow | null | undefined> => {
    if (!owner || (await signedInAs()) !== owner) return undefined;
    const res = await settleWithin(
      supabase
        .from("voice_explanations")
        .select("id, student_id, task_id, proof_id, storage_path, transcription_idempotency_key")
        .eq(column as "id", value)
        .limit(1)
        .then((r) => r as unknown as { data: OwnerRow[] | null; error: unknown }, (e) => ({ data: null, error: e })),
      CHECK_TIMEOUT_MS, { data: null, error: "timeout" },
    );
    if (res.error) return undefined;
    return res.data?.[0] ?? null;
  }, []);

  /** Is the recording's file on the server? true / false / undefined (could not tell). */
  const fileExists = useCallback(async (owner: string | null | undefined, path: string): Promise<boolean | undefined> => {
    if (!owner || (await signedInAs()) !== owner) return undefined;
    const dl = supabase.storage.from(BUCKET).download(path) as unknown as Promise<FileResult>;
    const r = await settleWithin<FileResult | "timeout">(dl, CHECK_TIMEOUT_MS, "timeout");
    return existenceOf(r);
  }, []);

  const startPolling = useCallback((voiceId: string, key: string, job: StoredJob) => {
    stopPolling();
    pollFailuresRef.current = 0;
    activePollIdRef.current = voiceId;
    const epoch = epochRef.current!.current;
    void checkJob(voiceId, epoch, key, job); // don't wait for the first tick to show current state
    pollTimerRef.current = setInterval(() => void checkJob(voiceId, epoch, key, job), POLL_MS);
  }, [checkJob, stopPolling]);

  /**
   * Makes sure the server has the recording's file (audit F5). With the audio
   * still on this page it is (re)sent to its own path - a 409 means an earlier
   * attempt already stored it. Without the audio (the page that recorded it is
   * gone) an upload that was in progress is checked for on the server.
   *   stored  - the file is there; the record now says "uploaded"
   *   refused - the server answered no; nothing was stored
   *   lost    - never reached the server and the audio is gone
   *   unknown - no answer; the record and any audio on this page are kept
   *   account - the signed-in account is not the owner; nothing was sent
   */
  const ensureUploaded = useCallback(async (key: string, job: StoredJob): Promise<
    { kind: "stored"; job: StoredJob } | { kind: "refused"; message: string } | { kind: "lost" | "unknown" | "account" }
  > => {
    if (!job.stage || job.stage === "uploaded") return { kind: "stored", job };
    const recId = job.recordingId ?? "";
    const blob = pendingAudio.get(recId) ?? null;
    const markStored = (): StoredJob => {
      const stored: StoredJob = { ...(readJob(key) ?? job), stage: "uploaded" };
      updateJobIfSame(key, stored);
      pendingAudio.delete(recId);
      unsentRecordings.delete(recId);
      releaseMarker(key);
      return stored;
    };
    if (!blob) {
      if (job.stage === "recording") return { kind: "lost" };
      const exists = await fileExists(job.studentId, job.storagePath);
      if (exists === true) return { kind: "stored", job: markStored() };
      return { kind: exists === false ? "lost" : "unknown" };
    }
    try {
      await requireAccount(job.studentId);
    } catch {
      return { kind: "account" };
    }
    updateJobIfSame(key, { ...job, stage: "uploading" });
    const attempt = supabase.storage.from(BUCKET)
      .upload(job.storagePath, blob, { contentType: blob.type, upsert: false }) as unknown as Promise<FileResult>;
    const result = await settleWithin<FileResult | "timeout">(attempt, UPLOAD_TIMEOUT_MS, "timeout");
    const outcome = uploadOutcome(result);
    if (outcome === "stored") return { kind: "stored", job: markStored() };
    if (outcome === "refused") {
      return { kind: "refused", message: result !== "timeout" && result.error ? result.error.message : "refused" };
    }
    // No answer yet: if the upload does finish later, record that.
    if (result === "timeout") void attempt.then((late) => { if (uploadOutcome(late) === "stored" && readJob(key)) markStored(); });
    return { kind: "unknown" };
  }, [fileExists, readJob, updateJobIfSame]);

  /** After the file is stored: follow the job, find it by its key, or enqueue
   * it - always with the record's own key, path, duration, task and proof, and
   * only with its owner's session. */
  const enqueueAndFollow = useCallback(async (key: string, job: StoredJob, current: () => boolean) => {
    if (current()) activeKeyRef.current = key;
    if (job.voiceId) {
      if (!current()) return;
      setPhase("queued");
      startPolling(job.voiceId, key, job);
      return;
    }
    if (current()) setPhase("saving");
    const found = await findOwnRow(job.studentId, "transcription_idempotency_key", job.idempotencyKey);
    if (found) {
      if (!rowMatchesMarker(found, job, ctxOf(job))) {
        if (current()) showUnresolved(key, job, false, false);
        return;
      }
      updateJobIfSame(key, { ...job, voiceId: found.id }); // recovery info, even if closed meanwhile
      if (!current()) return;
      setPhase("queued");
      startPolling(found.id, key, { ...job, voiceId: found.id });
      return;
    }
    // The server work runs to the end even if the dialog closed or moved on
    // (the screen is only touched while current). Never as another account.
    // Not found, or the lookup failed: retrying the enqueue is still safe (the
    // server reuses the row for the same key). A lost answer is retried once,
    // after looking for the job again.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        const again = await findOwnRow(job.studentId, "transcription_idempotency_key", job.idempotencyKey);
        if (again) {
          if (!rowMatchesMarker(again, job, ctxOf(job))) { if (current()) showUnresolved(key, job, false, false); return; }
          updateJobIfSame(key, { ...job, voiceId: again.id });
          if (!current()) return;
          setPhase("queued");
          startPolling(again.id, key, { ...job, voiceId: again.id });
          return;
        }
      }
      if ((await signedInAs()) !== job.studentId) return;
      const { data: enq, error: enqErr } = await settleWithin(
        supabase.functions
          .invoke("transcription-enqueue", { body: enqueueBody(job, job.taskId, job.proofId) })
          .then((r) => r, (e) => ({ data: null, error: e })),
        ENQUEUE_TIMEOUT_MS, { data: null, error: "timeout" },
      );
      if (!enqErr && enq?.voice_id) {
        updateJobIfSame(key, { ...job, voiceId: enq.voice_id });
        if (!current()) return;
        setPhase("queued");
        startPolling(enq.voice_id, key, { ...job, voiceId: enq.voice_id });
        return;
      }
    }
    if (current()) becomeUncertain("We couldn't confirm your recording was received. It may already be saved.");
  }, [becomeUncertain, findOwnRow, showUnresolved, startPolling, updateJobIfSame]);

  /** Upload (if needed) then enqueue; the screen says only what is confirmed. */
  const pushRecord = useCallback(async (key: string, job: StoredJob, current: () => boolean) => {
    if (current()) activeKeyRef.current = key;
    const up = await ensureUploaded(key, job);
    if (up.kind === "stored") return enqueueAndFollow(key, up.job, current);
    if (up.kind === "refused") {
      // The server answered and refused: nothing was stored, so the record goes.
      writeJob(key, null);
      pendingAudio.delete(job.recordingId ?? "");
      unsentRecordings.delete(job.recordingId ?? "");
      releaseMarker(key);
    }
    if (!current()) return;
    if (up.kind === "refused") {
      releaseLocalAudio();
      setError(`The recording was not saved (${up.message}). Please record again.`);
      setPhase("error");
    } else if (up.kind === "lost") {
      setPhase("interrupted");
    } else if (up.kind === "unknown") {
      becomeUncertain(pendingAudio.has(job.recordingId ?? "")
        ? "We couldn't confirm the upload finished (no answer from the server). The recording is still on this page - keep this tab open and resume to try again."
        : "We couldn't check whether your recording reached the server.");
    } else {
      becomeUncertain("You are now signed in as a different account, so this recording was not sent. Sign back in as its owner to continue.");
    }
  }, [becomeUncertain, enqueueAndFollow, ensureUploaded, releaseLocalAudio, writeJob]);

  /**
   * An older build's marker (key `taskId ?? proofId`, shared by every proof
   * under one task; older ones carry no student/task/proof). It is used here
   * only when it is known to be this work's: by its own fields (written by the
   * previous build), or by the server's row for it. Otherwise it stays exactly
   * where it is and the student chooses - it is never silently attached,
   * overwritten, deleted or re-enqueued with a guessed task/proof.
   */
  const adoptLegacy = useCallback(async (here: RecordingContext, epoch: number): Promise<void> => {
    const lkey = legacySlotKey(here);
    const legacy = readJob(lkey);
    if (!legacy || elsewhereRef.current.has(legacy.idempotencyKey)) return;
    const known = jobMatchesContext(legacy, here);
    if (known === "other") return;                      // its own fields say it is other work's
    let verdict: LegacyVerdict;
    if (known === "match") {
      verdict = { kind: "ours", job: { ...legacy, ...here } };
    } else {
      setPhase("checking");
      let row = legacy.voiceId
        ? await findOwnRow(here.studentId, "id", legacy.voiceId)
        : await findOwnRow(here.studentId, "transcription_idempotency_key", legacy.idempotencyKey);
      if (row === null && !legacy.voiceId) row = await findOwnRow(here.studentId, "storage_path", legacy.storagePath);
      verdict = classifyLegacy(legacy, here, row);
    }
    if (!epochRef.current!.isCurrent(epoch) || !mountedRef.current) return;   // stale: marker untouched
    if (verdict.kind === "elsewhere") {
      elsewhereRef.current.add(legacy.idempotencyKey);
      setPhase("idle");
      return;
    }
    if (verdict.kind === "unresolved") {
      showUnresolved(lkey, legacy, true, verdict.canAttach);
      return;
    }
    moveRecord(lkey, verdict.job);
  }, [findOwnRow, moveRecord, readJob, showUnresolved]);

  /** Is there a recording for exactly this context that this page should pick up? */
  const hasPendingRecovery = useCallback((): boolean => {
    if (pickResumable(listMarkers(), ctx, (j) => ownerOf(j, TAB_ID, Date.now())).next) return true;
    if (readJob(slot)) return true;                              // previous build's record for this exact work
    const legacy = readJob(legacySlotKey(ctx));
    return !!legacy && jobMatchesContext(legacy, ctx) !== "other" && !elsewhereRef.current.has(legacy.idempotencyKey);
  }, [ctx, listMarkers, readJob, slot]);

  /** Resume whatever this context's recovery record says is in flight - on
   * reopen/remount, after a lost answer, or from "Resume existing recording".
   * Only ever with this student's own session; never another open tab's
   * recording that is still being sent. */
  const resumeStoredJob = useCallback(async (opts?: { ownSave?: boolean }) => {
    const here = ctx;
    const hereSlot = slotKey(here);
    // A recording for this slot is still in progress on this page (possibly from
    // a dialog that has since closed): show that and wait - its end triggers this again.
    if (!opts?.ownSave && uploadRegistry.isActive(hereSlot)) {
      waitingForSlotRef.current = true;
      setPhase("saving");
      return;
    }
    const epoch = epochRef.current!.current;
    const flight = `${epoch}:${hereSlot}`;
    if (resumesInFlightRef.current.has(flight)) return;   // one resume per session and slot
    resumesInFlightRef.current.add(flight);
    const current = () => epochRef.current!.isCurrent(epoch) && mountedRef.current;
    const owner = (j: StoredJob) => ownerOf(j, TAB_ID, Date.now());
    try {
      if ((await signedInAs()) !== here.studentId) return;   // never resume as another account
      if (!current()) return;
      // Records from earlier builds move to per-recording keys first.
      const v2 = readJob(hereSlot);
      if (v2 && jobMatchesContext(v2, here) === "match") moveRecord(hereSlot, v2);
      if (!pickResumable(listMarkers(), here, owner).next) {
        await adoptLegacy(here, epoch);
        if (!current()) return;
      }
      const { next, otherPages } = pickResumable(listMarkers(), here, owner);
      setOtherTabs(otherPages);
      if (!next) return;
      const { key, job } = next;
      setError(null);
      setJobError(null);
      setUncertainReason(null);
      // Audio after a refresh comes from the stored file, played through an
      // authenticated download - never an empty URL.
      setSavedResult((prev) => ({
        ...(prev ?? { transcript: "", segments: [], score: null, notes: null }),
        storagePath: job.storagePath,
      }));
      setPhase("saving");
      await pushRecord(key, job, current);
    } finally {
      resumesInFlightRef.current.delete(flight);
    }
  }, [adoptLegacy, ctx, listMarkers, moveRecord, pushRecord, readJob]);

  /** Student's explicit choice for an unresolved older marker that never
   * reached the server: it is this work's recording - save it here. */
  const attachLegacyHere = useCallback(() => {
    const u = unresolvedRef.current;
    if (!u || !u.legacy || !legacyCanAttach) return;
    moveRecord(u.key, { ...u.job, voiceId: null, ...ctx, aside: false });
    unresolvedRef.current = null;
    void resumeStoredJob();
  }, [ctx, legacyCanAttach, moveRecord, resumeStoredJob]);

  /** Student's explicit choice: keep a record aside (listed below Start, never
   * deleted without being asked) and record a new one here. */
  const keepAside = useCallback((key: string, job: StoredJob, legacy: boolean) => {
    if (legacy) moveRecord(key, { ...job, studentId: job.studentId ?? ctx.studentId, aside: true });
    else { touchMarker(key, { aside: true }); releaseMarker(key); }
    unresolvedRef.current = null;
    activeKeyRef.current = null;
    refreshAside();
  }, [ctx.studentId, moveRecord, refreshAside]);

  // Follow a recording for this slot that is in progress anywhere on the page.
  // When it finishes, an open dialog resumes from the record it left (if any).
  useEffect(() => {
    const key = slot;
    setSlotBusy(uploadRegistry.isActive(key));
    return uploadRegistry.subscribe(key, () => {
      const busy = uploadRegistry.isActive(key);
      setSlotBusy(busy);
      // Only a dialog that was WAITING for that save picks it up; the dialog
      // that made the save is already following it.
      if (!busy && waitingForSlotRef.current && openRef.current && mountedRef.current) {
        waitingForSlotRef.current = false;
        if (ASYNC_TRANSCRIPTION && hasPendingRecovery()) void resumeStoredJob();
        else setPhase("idle");
      }
    });
  }, [slot, hasPendingRecovery, resumeStoredJob]);

  // Reopening the modal (or a fresh mount after a page refresh) recovers an
  // existing job instead of offering to start a new recording over it.
  useEffect(() => {
    if (!open || !ASYNC_TRANSCRIPTION) return;
    refreshAside();
    void resumeStoredJob();
    return () => stopPolling();
  }, [open, refreshAside, resumeStoredJob, stopPolling]);

  /** Step 6D async path: store, then hand off to the queue and poll for the
   * server's own transcript rather than trusting the browser's. */
  const saveAsync = useCallback(async (blob: Blob, seconds: number, audioUrl: string, rec: Recording) => {
    // The server work always runs to the end so the recording is never lost;
    // the screen and the blob URL are only touched while this dialog session -
    // and this exact context - is still current.
    const current = () => epochRef.current!.isCurrent(rec.epoch) && mountedRef.current && slotRef.current === rec.slot;
    if (current()) {
      setPhase("saving");
      setJobStatus(null);
      setJobError(null);
      setScoringPending(false);
      // Never restore a URL that close/replacement has already revoked.
      const liveUrl = blobOwnerRef.current!.current === audioUrl ? audioUrl : undefined;
      setSavedResult({ transcript: "", segments: [], score: null, notes: null, audioUrl: liveUrl, storagePath: rec.path });
    }
    pendingAudio.set(rec.id, blob);
    const job: StoredJob = {
      ...(readJob(rec.key) ?? {
        voiceId: null, idempotencyKey: rec.idempotencyKey, storagePath: rec.path, durationSeconds: null,
        ...rec.ctx, recordingId: rec.id, createdAt: Date.now(),
      }),
      durationSeconds: seconds, stage: "uploading", tabId: TAB_ID, heartbeatAt: Date.now(),
    };
    writeJob(rec.key, job);   // "uploading", written BEFORE the upload is sent
    holdMarker(rec.key);
    await pushRecord(rec.key, job, current);
  }, [pushRecord, readJob, writeJob]);

  const save = useCallback(async (
    blob: Blob, spoken: string, segments: TranscriptSegment[], seconds: number, rec: Recording, token: symbol,
  ) => {
    // Each recording is saved once (a double-click or a duplicate onstop must
    // not upload/enqueue/insert twice); recordings of other contexts - or a
    // newer one here - are never blocked by it.
    if (savedRecordingsRef.current.has(rec.id)) return;
    savedRecordingsRef.current.add(rec.id);
    const current = () => epochRef.current!.isCurrent(rec.epoch) && mountedRef.current && slotRef.current === rec.slot;
    try {
      if (ASYNC_TRANSCRIPTION) {
        // A local copy only if this dialog session is still showing it.
        const url = current() ? blobOwnerRef.current!.adopt(URL.createObjectURL(blob)) : "";
        await saveAsync(blob, seconds, url, rec);
        return;
      }
      if (current()) setPhase("saving");
      await requireAccount(rec.ctx.studentId);
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(rec.path, blob, { contentType: blob.type, upsert: false });
      if (upErr) throw upErr;

      const words = spoken.trim() ? spoken.trim().split(/\s+/).length : 0;

      await requireAccount(rec.ctx.studentId);
      const { data: row, error: insErr } = await supabase
        .from("voice_explanations")
        .insert({
          student_id: rec.ctx.studentId,
          task_id: rec.ctx.taskId,
          proof_id: rec.ctx.proofId,
          storage_path: rec.path,
          duration_seconds: seconds,
          transcript: spoken.trim() || null,
          transcript_segments: (segments.length ? segments : null) as never, // column added in migration 16; types.ts predates it
          word_count: words,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      // Scoring runs on the server. A short or missing transcript is saved
      // anyway — the audio is the evidence, and a human can still listen.
      let score: number | null = null;
      let notes: string | null = null;
      if (words >= MIN_WORDS && (await signedInAs()) === rec.ctx.studentId) {
        const { data: scored } = await supabase.functions.invoke("voice-score", { body: { voice_id: row.id } });
        // A number only when the server actually scored it (not pending/failed).
        score = scoreToShow(scored?.success === true ? "scored" : null, scored?.communication_score);
        notes = scored?.notes ?? null;
      }

      onSavedRef.current?.(); // the row is saved whether or not this dialog is still open
      if (!current()) return; // closed or moved on meanwhile: no blob URL, no screen update
      setSavedResult({ transcript: spoken.trim(), segments, score, notes, audioUrl: blobOwnerRef.current!.adopt(URL.createObjectURL(blob)), storagePath: rec.path });
      setPhase("done");
    } catch (err) {
      if (current()) {
        releaseLocalAudio();
        setError(err instanceof AccountChanged
          ? "You are now signed in as a different account, so this recording was not sent."
          : err instanceof Error ? err.message : "Could not save the recording.");
        setPhase("error");
      }
    } finally {
      uploadRegistry.end(rec.slot, token);
      unsentRecordings.delete(rec.id);   // (audio still only on this page stays in pendingAudio: leave-warning continues)
    }
  }, [saveAsync, releaseLocalAudio]);

  const stop = useCallback(() => {
    const m = mediaRef.current;
    if (m?.recorder?.state === "recording") {
      stopAtRef.current = Date.now();
      m.recorder.stop();
    }
  }, []);

  const start = useCallback(async () => {
    // One Start at a time, and never while a recorder already exists.
    if (startingRef.current || mediaRef.current) return;
    // Never touch the microphone without this student's own consent.
    if (consentRef.current.student !== ctx.studentId || consentRef.current.value !== true) return;
    // A recording for this slot still in progress (maybe from a closed dialog): wait for it.
    if (uploadRegistry.isActive(slot)) { waitingForSlotRef.current = true; setPhase("saving"); return; }
    // Never start over a recording the server may still hold (or an older
    // marker not yet matched to other work): resume it. Only an explicit
    // "keep aside" clears the way.
    if (ASYNC_TRANSCRIPTION && hasPendingRecovery()) {
      await resumeStoredJob();
      return;
    }
    startingRef.current = true;
    setStarting(true);
    const epoch = epochRef.current!.next(); // a new recording: older continuations are now stale
    const startSlot = slot;
    const startCtx = ctx;
    const isCurrent = () => epochRef.current!.isCurrent(epoch) && mountedRef.current && slotRef.current === startSlot;
    const abandonStart = () => {
      startingRef.current = false;
      if (mountedRef.current && epochRef.current!.isCurrent(epoch)) setStarting(false);
    };
    setError(null);
    setSecondsLeft(MAX_SECONDS);
    setJobStatus(null);
    setJobError(null);
    setUncertainReason(null);
    setScoringPending(false);
    blobOwnerRef.current?.release(); // the previous recording's local copy
    setSavedResult(null);
    stopAtRef.current = null;

    // The recording belongs to the signed-in account, which must be this student.
    if ((await signedInAs()) !== startCtx.studentId) {
      abandonStart();
      if (isCurrent()) {
        setError("You are signed in as a different account from the one this page shows. Reload the page, then try again.");
        setPhase("error");
      }
      return;
    }

    let stream: MediaStream;
    try {
      stream = await openMic();
    } catch {
      abandonStart();
      if (isCurrent()) {
        setError("Microphone blocked. Allow it in your browser and try again.");
        setPhase("error");
      }
      return;
    }
    // Permission can resolve after the dialog closed, unmounted or moved to
    // another context: release the microphone at once and never start a recorder.
    if (!isCurrent() || !openRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      abandonStart();
      return;
    }
    startingRef.current = false;
    setStarting(false);

    const media: MediaSession = { stream, recorder: null, chunks: [], meter: null, raf: null, ended: false };
    mediaRef.current = media;
    let recorder: MediaRecorder;
    try {
      // A moving level meter, so it is obvious the microphone is live. A silent
      // dead recorder that looks fine is worse than no recorder.
      media.meter = new AudioContext();
      const analyser = media.meter.createAnalyser();
      analyser.fftSize = 256;
      media.meter.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (media.ended) return;
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        if (mediaRef.current === media) setLevel(Math.min(1, peak / 60));
        media.raf = requestAnimationFrame(tick);
      };
      tick();
      recorder = makeRecorder(stream);
      media.recorder = recorder;
    } catch {
      // The level meter or the recorder could not start on this device:
      // release everything and let the student try again.
      endMedia(media);
      setError("Couldn't start recording on this device. Close other apps using the microphone and try again.");
      setPhase("error");
      return;
    }

    // Fixed now, before any audio: this recording's id, context, record, path and key.
    const { type, ext } = recordingFormat(recorder);
    const id = crypto.randomUUID();
    const rec: Recording = {
      id, ctx: startCtx, slot: startSlot, key: markerKey(id), path: recordingPath(startCtx.studentId, id, ext),
      idempotencyKey: crypto.randomUUID(), type, epoch,
    };
    const started = Date.now();
    // From now until it is stored, this recording holds its slot on this page,
    // has its own recovery record (async path) and warns before the page closes.
    const token = uploadRegistry.begin(rec.slot);
    unsentRecordings.add(rec.id);
    const giveUp = () => {
      writeJob(rec.key, null);                              // definitely never sent
      releaseMarker(rec.key);
      unsentRecordings.delete(rec.id);
      uploadRegistry.end(rec.slot, token);
    };

    recorder.ondataavailable = (e) => { if (e.data.size) media.chunks.push(e.data); };   // this recorder's own buffer
    recorder.onstop = async () => {
      endMedia(media);                                     // this recorder's own microphone only
      // Real elapsed time up to the moment a stop was asked for, capped -
      // never more than the limit, even if a throttled tab stopped it late.
      const seconds = recordedSeconds(started, stopAtRef.current ?? Date.now(), MAX_SECONDS);
      const blob = new Blob(media.chunks, { type: rec.type });
      if (isCurrent()) setPhase(ASYNC_TRANSCRIPTION ? "saving" : "transcribing");

      // The audio itself must not be longer than the limit. A suspended or
      // frozen page can keep capturing while no timer runs, so the capped
      // duration_seconds alone does not bound it. When the browser can
      // measure it and it is too long, nothing is uploaded. (A browser that
      // cannot decode it falls through - see the server-side note in the
      // Step 6 evidence doc.)
      if (audioTooLong(await decodedSeconds(blob), MAX_SECONDS)) {
        giveUp();
        if (isCurrent()) {
          setError("This recording ran past 60 seconds while the page was in the background, so it was not saved. Please record again.");
          setPhase("error");
        }
        return;
      }

      if (ASYNC_TRANSCRIPTION) {
        // The whole point of this path: the browser never transcribes at
        // all, Whisper runs once, server-side, after upload+enqueue.
        void save(blob, "", [], seconds, rec, token);
        return;
      }
      setTranscribeProgress(null);
      // Transcription is sent with the signed-in session: only while that is still
      // the owner. On any failure save() runs anyway - it re-checks the account and
      // refuses to send as anyone else; otherwise the audio is saved untranscribed.
      requireAccount(rec.ctx.studentId)
        .then(() => transcribeWithTimestamps(blob, setTranscribeProgress))
        .then((r) => save(blob, r.text, r.segments, seconds, rec, token))
        .catch(() => save(blob, "", [], seconds, rec, token));
    };

    if (ASYNC_TRANSCRIPTION) {
      writeJob(rec.key, {
        voiceId: null, idempotencyKey: rec.idempotencyKey, storagePath: rec.path, durationSeconds: null, ...rec.ctx,
        recordingId: rec.id, stage: "recording", tabId: TAB_ID, heartbeatAt: Date.now(), createdAt: Date.now(),
      });
      holdMarker(rec.key);
    }
    // A chunk every second, so a recording stopped by the clock or a closed
    // dialog still holds everything said up to that moment.
    try {
      recorder.start(1000);
    } catch {
      endMedia(media);
      giveUp();
      setError("Couldn't start recording on this device. Close other apps using the microphone and try again.");
      setPhase("error");
      return;
    }
    recordStartedAtRef.current = started;
    setSecondsLeft(MAX_SECONDS);
    setPhase("recording");
  }, [ctx, endMedia, hasPendingRecovery, resumeStoredJob, save, slot, writeJob]);

  /** Explicit, student-chosen: keep the uncertain recording aside (listed, not
   * deleted) and record anew. It may still finish on the server. */
  const abandonAndRecordAgain = useCallback(() => {
    epochRef.current!.next(); // late answers for it are ignored here
    stopPolling();
    const key = activeKeyRef.current;
    const job = key ? readJob(key) : null;
    if (key && job) keepAside(key, job, false);
    setJobStatus(null);
    setJobError(null);
    setUncertainReason(null);
    blobOwnerRef.current?.release();
    setSavedResult(null);
    setPhase("idle");
  }, [keepAside, readJob, stopPolling]);

  /** A recording that confirmably never reached the server: the student
   * acknowledges it and records again (its record is removed). */
  const acknowledgeInterrupted = useCallback(() => {
    const key = activeKeyRef.current;
    if (key) { writeJob(key, null); releaseMarker(key); }
    activeKeyRef.current = null;
    setSavedResult(null);
    setPhase("idle");
  }, [writeJob]);

  /** "Check" on a kept-aside recording: on the server, can be saved here, or gone? */
  const checkAside = useCallback(async (e: AsideEntry) => {
    setAsideChecks((m) => ({ ...m, [e.key]: "checking" }));
    const j = e.job;
    let row = j.voiceId
      ? await findOwnRow(j.studentId, "id", j.voiceId)
      : await findOwnRow(j.studentId, "transcription_idempotency_key", j.idempotencyKey);
    if (row === null) row = await findOwnRow(j.studentId, "storage_path", j.storagePath);
    let result: AsideCheck;
    if (row === undefined) result = "unknown";
    else if (row && (row.storage_path === j.storagePath || row.transcription_idempotency_key === j.idempotencyKey)) result = "saved";
    else if (pendingAudio.has(j.recordingId ?? "")) result = "can-save";
    else {
      const exists = j.stage === "recording" ? false : await fileExists(j.studentId, j.storagePath);
      result = exists === true ? "can-save" : exists === false ? "lost" : "unknown";
    }
    setAsideChecks((m) => ({ ...m, [e.key]: result }));
  }, [fileExists, findOwnRow]);

  /** Explicit: this kept-aside recording (never processed on the server) is for this work. */
  const saveAsideHere = useCallback((e: AsideEntry) => {
    if (hasPendingRecovery()) return;
    writeJob(e.key, { ...e.job, ...ctx, voiceId: null, aside: false, createdAt: Date.now() });
    refreshAside();
    void resumeStoredJob();
  }, [ctx, hasPendingRecovery, refreshAside, resumeStoredJob, writeJob]);

  /** Explicit: forget a kept-aside recording on this device (the server's copy, if any, is not touched). */
  const removeAside = useCallback((e: AsideEntry) => {
    writeJob(e.key, null);
    pendingAudio.delete(e.job.recordingId ?? "");
    unsentRecordings.delete(e.job.recordingId ?? "");
    releaseMarker(e.key);
    refreshAside();
  }, [refreshAside, writeJob]);

  // The clock stops the recording rather than the student. Sixty seconds is the
  // whole point — a longer answer is a written answer read aloud. It is measured
  // from real elapsed time (not a count of timer ticks, which background tabs
  // throttle), re-checked on every tick and on a timer aimed at the deadline.
  // A page that is hidden, left or frozen cannot be trusted to run the clock at
  // all, so the recording is stopped at that moment. Hidden: the page keeps
  // running and sends it. Left/closed: it may not be sent - the recovery
  // record then says so on the next visit ("interrupted"), never "saved".
  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = recordStartedAtRef.current;
    const check = () => {
      const c = recordingClock(startedAt, Date.now(), MAX_SECONDS);
      setSecondsLeft(c.secondsLeft);
      if (c.expired) stop();
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") stop(); else check(); };
    check();
    const every = setInterval(check, 250);
    const deadline = setTimeout(check, Math.max(0, startedAt + MAX_SECONDS * 1000 - Date.now()));
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("freeze", stop);
    window.addEventListener("pagehide", stop);
    return () => {
      clearInterval(every);
      clearTimeout(deadline);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("freeze", stop);
      window.removeEventListener("pagehide", stop);
    };
  }, [phase, stop]);

  // Asked once. After the first yes this query is the only cost.
  useEffect(() => {
    // A different student (or a reopen) never inherits the previous answer,
    // and any read or "I understand" still in flight becomes stale.
    const gen = ++consentGenRef.current;
    setConsent({ student: "", value: null });
    setAcceptingFor(null);
    if (!open || !studentId) return;
    const forStudent = studentId;
    void supabase
      .from("student_profiles")
      .select("voice_consent_at")
      .eq("id", forStudent)
      .maybeSingle()
      .then(({ data, error: consentErr }) => {
        if (consentGenRef.current !== gen) return;
        // If the answer cannot be read, ask again rather than assume a yes.
        setConsent({ student: forStudent, value: consentErr ? false : Boolean(data?.voice_consent_at) });
      }, () => { if (consentGenRef.current === gen) setConsent({ student: forStudent, value: false }); });
  }, [open, studentId]);

  const acceptConsent = async () => {
    const forStudent = studentId;
    const gen = consentGenRef.current;
    if (acceptingFor === forStudent) return;
    setAcceptingFor(forStudent);
    // Consent is recorded for the signed-in account: only send it as this student.
    const sameAccount = (await signedInAs()) === forStudent;
    const { error } = sameAccount
      ? await supabase.rpc("accept_voice_consent").then((r) => r, (e) => ({ error: e as Error }))
      : { error: new Error("You are signed in as a different account. Reload the page.") };
    // Another student, a close or a reopen since: this answer is not theirs
    // (the server recorded it for the account that sent it, nothing more).
    if (consentGenRef.current !== gen || !mountedRef.current) return;
    setAcceptingFor(null);
    if (error) {
      toast({ title: "Could not save that", description: error.message, variant: "destructive" });
      return;
    }
    setConsent({ student: forStudent, value: true });
  };

  /** Ends this dialog session: everything in flight becomes stale (a late
   * microphone grant stops its stream, late answers are ignored), the local
   * copy is dropped (reopening plays the stored file), recovery details stay. */
  const endSession = useCallback(() => {
    epochRef.current!.next();
    waitingForSlotRef.current = false;
    startingRef.current = false;
    setStarting(false);
    unresolvedRef.current = null;
    activeKeyRef.current = null;
    setLegacyCanAttach(false);
    setOtherTabs(0);
    // Stopping the microphone ends the recorder; its own onstop still sends what was said.
    if (mediaRef.current) endMedia(mediaRef.current);
    stopPolling();
    releaseLocalAudio();
    setPhase("idle");
  }, [endMedia, stopPolling, releaseLocalAudio]);

  const close = (next: boolean) => {
    if (!next) endSession();
    onOpenChange(next);
  };

  // The parent can close the dialog without going through `close` (open=false).
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (wasOpenRef.current && !open) endSession();
    wasOpenRef.current = open;
  }, [open, endSession]);

  // The account (or the task/proof) can change while this stays mounted: never
  // carry anything over - not the session, the result, the key or the consent.
  const contextRef = useRef(slot);
  useEffect(() => {
    if (contextRef.current === slot) return;
    contextRef.current = slot;
    endSession();
    setSavedResult(null);
    setJobStatus(null);
    setJobError(null);
    setUncertainReason(null);
    setScoringPending(false);
    setError(null);
    setAsideChecks({});
    // Pick up the NEW context's own job, if any. (The resume-on-open effect
    // above may already have run for it; this reset just cancelled that, so
    // resume again - resumeStoredJob only ever uses this context's records.)
    if (openRef.current && ASYNC_TRANSCRIPTION) {
      refreshAside();
      void resumeStoredJob();
    }
  }, [slot, endSession, refreshAside, resumeStoredJob]);

  const unresolved = unresolvedRef.current;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" /> Explain it — 60 seconds
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{prompt}</p>

        {phase === "idle" && consented === false && (
          <div className="space-y-3">
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm font-medium">Before you record</p>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
                <li>Your voice is recorded and stored with your work.</li>
                <li>
                  It is scored for how clearly you explain the work — not for your accent or
                  your English.
                </li>
                <li>
                  Only you can play the recording. Your college sees how many recordings you
                  have made, not the recordings themselves.
                </li>
                <li>
                  The ProofLab team can read the written transcript and score. If you make your
                  profile public, verified companies can see your score and feedback — never the
                  audio.
                </li>
                <li>
                  You can delete any recording at any time, from Profile → Privacy.
                </li>
              </ul>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void acceptConsent()} disabled={accepting} className="flex-1">
                {accepting ? "Saving…" : "I understand — continue"}
              </Button>
              <Button variant="ghost" onClick={() => close(false)}>Not now</Button>
            </div>
          </div>
        )}

        {phase === "idle" && consented === true && (
          <div className="space-y-3">
            <p className="text-sm">
              Say it in your own words, as if to a teammate. Mention what you tried first
              and anything you changed your mind about.
            </p>
            {otherTabs > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="voice-other-tab">
                A recording for this work is still being sent from another open tab. Keep that tab open until it finishes.
              </p>
            )}
            {slotBusy ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="voice-slot-busy">
                <Loader2 className="h-4 w-4 animate-spin" /> Your previous recording is still uploading…
              </p>
            ) : (
              <Button onClick={() => void start()} className="w-full" disabled={starting}>
                {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mic className="h-4 w-4 mr-2" />}
                {starting ? "Starting microphone…" : "Start recording"}
              </Button>
            )}
            {asideList.length > 0 && (
              <div className="rounded-lg border p-3 space-y-2" data-testid="voice-aside-list">
                <p className="text-sm font-medium">Recordings you kept aside ({asideList.length})</p>
                <p className="text-xs text-muted-foreground">
                  These are remembered in this browser only. Check each one: it may already be saved.
                </p>
                {asideList.map((e) => {
                  const state = asideChecks[e.key];
                  return (
                    <div key={e.key} className="space-y-1 border-t pt-2" data-testid="voice-aside-item">
                      <p className="text-xs">
                        Recorded {e.job.createdAt ? new Date(e.job.createdAt).toLocaleString() : "earlier"}
                        {e.job.durationSeconds ? ` · ${e.job.durationSeconds}s` : ""}
                      </p>
                      {state === "saved" && <p className="text-xs text-green-700">It is saved on the server — you'll find it in your build-log.</p>}
                      {state === "can-save" && <p className="text-xs">It was never processed. You can save it to this work.</p>}
                      {state === "lost" && <p className="text-xs">It never reached the server and the audio is gone. It can't be recovered.</p>}
                      {state === "unknown" && <p className="text-xs">We couldn't check right now. Try again later.</p>}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={state === "checking"} onClick={() => void checkAside(e)}>
                          {state === "checking" ? "Checking…" : "Check"}
                        </Button>
                        {state === "can-save" && (
                          <Button size="sm" variant="outline" onClick={() => saveAsideHere(e)}>Save it to this work</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => removeAside(e)}>Remove from this list</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {phase === "recording" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold tabular-nums">{secondsLeft}s</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-destructive transition-[width] duration-100"
                  style={{ width: `${Math.round(level * 100)}%` }}
                />
              </div>
            </div>
            <Button variant="destructive" onClick={stop} className="w-full">
              <Square className="h-4 w-4 mr-2" /> Stop and save
            </Button>
            <p className="text-xs text-muted-foreground">
              Keep this page open until you see “Saved”. Switching away stops the recording;
              closing or leaving the page before then means it may not be saved.
            </p>
          </div>
        )}

        {phase === "transcribing" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {transcribeProgress?.stage === "loading"
              ? `Preparing (first time only)… ${transcribeProgress.percent ?? 0}%`
              : "Writing down what you said…"}
          </div>
        )}

        {phase === "saving" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {ASYNC_TRANSCRIPTION ? "Uploading your recording…" : "Saving your explanation…"}
          </div>
        )}

        {phase === "queued" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {jobStatus === "processing"
              ? "Writing down what you said…"
              : "Queued — this can take a moment while other recordings finish first…"}
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-3 py-2">
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Saved. It will appear in your build-log.
            </p>
            {savedResult && (
              <div className="rounded-lg border p-3 max-h-72 overflow-y-auto">
                <RecordingPlayback
                  key={savedResult.audioUrl ?? savedResult.storagePath ?? "none"}
                  src={savedResult.audioUrl || undefined}
                  storagePath={savedResult.audioUrl ? undefined : savedResult.storagePath}
                  transcript={savedResult.transcript}
                  segments={savedResult.segments} />
                {savedResult.score != null && (
                  <p className="mt-2 text-sm font-medium">Communication score {savedResult.score}/100</p>
                )}
                {savedResult.score == null && scoringPending && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Grading your explanation… You can close this; it will be scored either way.
                  </p>
                )}
                {savedResult.notes && <p className="text-xs text-muted-foreground mt-1">{savedResult.notes}</p>}
              </div>
            )}
            {savedResult && (
              <Button
                variant="outline" className="w-full gap-1.5"
                onClick={() => exportTranscriptPdf({
                  title: "Spoken Explanation",
                  // score is already gated to a server-confirmed one (scoreToShow)
                  entries: [exportEntry(savedResult, prompt)],
                }, `explanation-${Date.now()}.pdf`)}
              >
                <FileDown className="h-4 w-4" /> Download PDF
              </Button>
            )}
            <Button className="w-full" onClick={() => close(false)}>Done</Button>
          </div>
        )}

        {phase === "checking" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking an earlier recording…
          </div>
        )}

        {phase === "legacy" && (
          <div className="space-y-3" data-testid="voice-legacy">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                We found an unfinished recording, but we can't confirm that it belongs to this piece of
                work, so it isn't shown here. It has not been deleted.
              </AlertDescription>
            </Alert>
            <Button className="w-full" onClick={() => void resumeStoredJob()}>
              <RotateCcw className="h-4 w-4 mr-2" /> Check again
            </Button>
            {legacyCanAttach && (
              <Button variant="outline" className="w-full" onClick={attachLegacyHere}>
                It was for this work — save it here
              </Button>
            )}
            <Button
              variant="ghost" className="w-full text-muted-foreground"
              onClick={() => { if (unresolved) keepAside(unresolved.key, unresolved.job, unresolved.legacy); setPhase("idle"); }}
            >
              Keep it aside and record a new one
            </Button>
          </div>
        )}

        {phase === "interrupted" && (
          <div className="space-y-3" data-testid="voice-interrupted">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Your last recording for this work was interrupted before it reached the server (for
                example, the page was closed or reloaded), so it was not saved.
              </AlertDescription>
            </Alert>
            <Button className="w-full" onClick={acknowledgeInterrupted}>Record it again</Button>
          </div>
        )}

        {phase === "uncertain" && (
          <div className="space-y-3" data-testid="voice-uncertain">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{uncertainReason}</AlertDescription>
            </Alert>
            <Button className="w-full" onClick={() => void resumeStoredJob()}>
              <RotateCcw className="h-4 w-4 mr-2" /> Resume existing recording
            </Button>
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={abandonAndRecordAgain}>
              Keep it aside and record a new one
            </Button>
            <p className="text-xs text-muted-foreground">
              A recording kept aside is listed below Start, where you can check on it later. It may still
              finish and appear in your build-log.
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{jobError ?? error}</AlertDescription>
            </Alert>
            <Button
              variant="outline" className="w-full"
              onClick={() => {
                // Only reached when nothing is in flight (the job failed for
                // good, or nothing was sent) - start() still refuses to start
                // over a stored job and resumes it instead.
                setJobStatus(null);
                setJobError(null);
                setPhase("idle");
              }}
            >
              Try recording again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default VoiceExplainModal;
