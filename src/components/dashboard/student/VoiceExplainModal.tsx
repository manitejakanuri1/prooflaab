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
  audioTooLong, createEpoch, exportEntry, markerBelongsTo, recordedSeconds, recordingClock, safeStore, scoreToShow,
  settleWithin, uploadRegistry,
} from "@/lib/voiceLifecycle";
import {
  classifyLegacy, enqueueBody, jobMatchesContext, legacySlotKey, nextFailures, parseStoredJob, recordingContext,
  SavedNotifier, slotKey, viewOf,
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
 * (an enqueue whose answer was lost, or progress checks that keep failing).
 * The saved recovery details are kept, and the only choices are to resume it
 * or to explicitly abandon it - never a silent fresh start over it.
 * "checking": an older build's recovery marker is being checked with the server.
 * "legacy": that check could not tell which work the older marker belongs to;
 * the student chooses (check again / keep it for this work / set it aside).
 */
type Phase = "idle" | "recording" | "transcribing" | "saving" | "queued" | "done" | "uncertain" | "checking" | "legacy" | "error";

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
 * One recording, fixed when Start is pressed. Every later step - upload,
 * recovery marker, enqueue, retry - uses these values, never the current
 * props, so a save that finishes after the dialog moved to another student,
 * task or proof still describes (and stores under) its own context.
 */
interface Recording {
  id: string;
  ctx: RecordingContext;
  slot: string;
  idempotencyKey: string;
  epoch: number;
}

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

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [savedResult, setSavedResult] = useState<SavedResult | null>(null);

  // The context this dialog is showing right now, and its recovery/upload slot.
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
  // An older build's marker that could not be matched to this work.
  const legacyRef = useRef<{ key: string; job: StoredJob; raw: string } | null>(null);
  const [legacyCanAttach, setLegacyCanAttach] = useState(false);
  const elsewhereRef = useRef(new Set<string>());        // older markers proven to belong to other work
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
  const [slotBusy, setSlotBusy] = useState(false); // a save for this slot is still in flight
  const waitingForSlotRef = useRef(false);          // this dialog is waiting for that save
  const recordStartedAtRef = useRef(0);             // Date.now() when recording began
  const stopAtRef = useRef<number | null>(null);    // Date.now() when a stop was asked for
  const releaseLocalAudio = useCallback(() => {
    blobOwnerRef.current?.release();
    setSavedResult((prev) => withoutLocalAudio(prev));
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current?.next();
      blobOwnerRef.current?.release();
    };
  }, []);

  // localStorage, with in-memory overrides for this page when writing or
  // removing is blocked (safeStore never throws).
  const readJob = useCallback((key: string): StoredJob | null => parseStoredJob(safeStore.get(key)), []);
  const writeJob = useCallback((key: string, job: StoredJob | null) => {
    if (job) safeStore.set(key, JSON.stringify(job));
    else safeStore.remove(key);
  }, []);
  /** Updates a marker only while it is still the same recording's (never
   * resurrects an abandoned one, never overwrites a newer one). */
  const updateJobIfSame = useCallback((key: string, job: StoredJob) => {
    if (readJob(key)?.idempotencyKey === job.idempotencyKey) writeJob(key, job);
  }, [readJob, writeJob]);
  /** Clears the marker only if it still belongs to this recording. */
  const clearJobFor = useCallback((key: string, voiceId: string) => {
    if (markerBelongsTo(readJob(key)?.voiceId, voiceId)) writeJob(key, null);
  }, [readJob, writeJob]);

  /** Something recoverable exists for this exact context: its own marker, or
   * an older build's marker not yet proven to belong to other work. */
  const hasPendingRecovery = useCallback((): boolean => {
    const own = readJob(slot);
    if (own && jobMatchesContext(own, ctx) === "match") return true;
    const legacy = readJob(legacySlotKey(ctx));
    return !!legacy && jobMatchesContext(legacy, ctx) !== "other" && !elsewhereRef.current.has(legacy.idempotencyKey);
  }, [ctx, readJob, slot]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    activePollIdRef.current = null;
  }, []);

  /** Recovery details are kept; the student chooses resume or abandon. */
  const becomeUncertain = useCallback((reason: string) => {
    stopPolling();
    setUncertainReason(reason);
    setPhase("uncertain");
  }, [stopPolling]);

  /** One check of the job's current row, shared by the poll loop and by a
   * reopened modal's first look. Reads only this student's own row (RLS
   * scopes every select to student_id = auth.uid()). A failed, timed-out or
   * empty read counts as a failure; after MAX_POLL_FAILURES in a row the page
   * stops and asks, instead of spinning forever. */
  const checkJob = useCallback(async (voiceId: string, epoch: number, key: string) => {
    const flight = `${epoch}:${voiceId}`;
    if (checksInFlightRef.current.has(flight)) return;    // one check at a time per job and session
    checksInFlightRef.current.add(flight);
    try {
      // types.ts predates migrations 41-45 (transcription_status and friends).
      const res = await settleWithin(
        supabase
          .from("voice_explanations")
          .select("id, transcription_status, transcript, transcript_segments, word_count, transcription_error, status, communication_score, communication_notes, storage_path")
          .eq("id", voiceId)
          .maybeSingle()
          .then((r) => r as unknown as { data: JobRow | null; error: unknown }, (e) => ({ data: null, error: e })),
        CHECK_TIMEOUT_MS, { data: null, error: "timeout" },
      );

      // A late answer after close/abandon/another recording: ignore entirely.
      if (!epochRef.current!.isCurrent(epoch) || activePollIdRef.current !== voiceId || !mountedRef.current) return;

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
  }, [becomeUncertain, stopPolling, clearJobFor]);

  /** This student's own row (RLS), found by id, idempotency key or storage
   * path, with who/what it belongs to. `undefined`: the lookup failed or
   * timed out (unknown). `null`: genuinely not there. */
  const findOwnRow = useCallback(async (
    column: "id" | "transcription_idempotency_key" | "storage_path", value: string,
  ): Promise<OwnerRow | null | undefined> => {
    const res = await settleWithin(
      supabase
        .from("voice_explanations")
        .select("id, student_id, task_id, proof_id")
        .eq(column as "id", value)
        .limit(1)
        .then((r) => r as unknown as { data: OwnerRow[] | null; error: unknown }, (e) => ({ data: null, error: e })),
      CHECK_TIMEOUT_MS, { data: null, error: "timeout" },
    );
    if (res.error) return undefined;
    return res.data?.[0] ?? null;
  }, []);

  const startPolling = useCallback((voiceId: string, key: string) => {
    stopPolling();
    pollFailuresRef.current = 0;
    activePollIdRef.current = voiceId;
    const epoch = epochRef.current!.current;
    void checkJob(voiceId, epoch, key); // don't wait for the first tick to show current state
    pollTimerRef.current = setInterval(() => void checkJob(voiceId, epoch, key), POLL_MS);
  }, [checkJob, stopPolling]);

  /**
   * An older build's marker (key `taskId ?? proofId`, shared by every proof
   * under one task; older ones carry no student/task/proof). It is used here
   * only when it is known to be this work's: by its own fields (written by the
   * previous build), or by the server's row for it. Otherwise it stays exactly
   * where it is and the student chooses - it is never silently attached,
   * overwritten, deleted or re-enqueued with a guessed task/proof.
   * Returns the marker to resume (now moved to this context's own slot), or null.
   */
  const adoptLegacy = useCallback(async (here: RecordingContext, epoch: number): Promise<StoredJob | null> => {
    const lkey = legacySlotKey(here);
    const raw = safeStore.get(lkey);
    const legacy = parseStoredJob(raw);
    if (!raw || !legacy || elsewhereRef.current.has(legacy.idempotencyKey)) return null;
    const known = jobMatchesContext(legacy, here);
    if (known === "other") return null;                 // its own fields say it is other work's
    let verdict: LegacyVerdict;
    if (known === "match") {
      verdict = { kind: "ours", job: { ...legacy, ...here } };
    } else {
      setPhase("checking");
      let row = legacy.voiceId
        ? await findOwnRow("id", legacy.voiceId)
        : await findOwnRow("transcription_idempotency_key", legacy.idempotencyKey);
      if (row === null && !legacy.voiceId) row = await findOwnRow("storage_path", legacy.storagePath);
      verdict = classifyLegacy(legacy, here, row);
    }
    if (!epochRef.current!.isCurrent(epoch) || !mountedRef.current) return null;   // stale: marker untouched
    if (verdict.kind === "elsewhere") {
      elsewhereRef.current.add(legacy.idempotencyKey);
      setPhase("idle");
      return null;
    }
    if (verdict.kind === "unresolved") {
      legacyRef.current = { key: lkey, job: legacy, raw };
      setLegacyCanAttach(verdict.canAttach);
      setPhase("legacy");
      return null;
    }
    // Proven this work's: move it to this context's own slot (never over
    // another marker), and retire the old key only once the move is readable.
    const key = slotKey(here);
    if (!readJob(key)) writeJob(key, verdict.job);
    if (readJob(key)?.idempotencyKey === verdict.job.idempotencyKey) writeJob(lkey, null);
    return readJob(key);
  }, [findOwnRow, readJob, writeJob]);

  /** Resume whatever this context's recovery marker says is in flight - on
   * reopen/remount, after a lost enqueue response, or from the "Resume
   * existing recording" button. Known voiceId: just poll. Unknown: ask the
   * server whether the job exists anyway, and only then retry the enqueue -
   * with the SAME idempotency key, storage path, duration, task and proof. */
  const resumeStoredJob = useCallback(async (opts?: { ownSave?: boolean }) => {
    const here = ctx;
    const key = slotKey(here);
    // A save for this slot is still uploading (possibly from a dialog that has
    // since closed): show that and wait - its finish triggers this again. The
    // save's own recovery (a lost enqueue answer) does not wait for itself.
    if (!opts?.ownSave && uploadRegistry.isActive(key)) {
      waitingForSlotRef.current = true;
      setPhase("saving");
      return;
    }
    const epoch = epochRef.current!.current;
    const flight = `${epoch}:${key}`;
    if (resumesInFlightRef.current.has(flight)) return;   // one resume per session and slot
    resumesInFlightRef.current.add(flight);
    const current = () => epochRef.current!.isCurrent(epoch) && mountedRef.current;
    try {
      let stored = readJob(key);
      if (stored && jobMatchesContext(stored, here) !== "match") stored = null; // never another context's
      if (!stored) {
        stored = await adoptLegacy(here, epoch);
        if (!stored || !current()) return;
      }
      const job = stored;
      setError(null);
      setJobError(null);
      setUncertainReason(null);
      // Audio after a refresh comes from the stored file, played through an
      // authenticated download - never an empty URL.
      setSavedResult((prev) => ({
        ...(prev ?? { transcript: "", segments: [], score: null, notes: null }),
        storagePath: job.storagePath,
      }));

      if (job.voiceId) {
        setPhase("queued");
        startPolling(job.voiceId, key);
        return;
      }

      setPhase("saving");
      const found = await findOwnRow("transcription_idempotency_key", job.idempotencyKey);
      if (found) {
        updateJobIfSame(key, { ...job, voiceId: found.id }); // recovery info, even if closed meanwhile
        if (!current()) return;
        setPhase("queued");
        startPolling(found.id, key);
        return;
      }
      if (!current()) return;

      // Not found, or the lookup failed: retrying the enqueue is still safe
      // (the server reuses the row for the same key), and it is the only way
      // forward if the first call never landed.
      const { data: enq, error: enqErr } = await settleWithin(
        supabase.functions
          .invoke("transcription-enqueue", { body: enqueueBody(job, here.taskId, here.proofId) })
          .then((r) => r, (e) => ({ data: null, error: e })),
        ENQUEUE_TIMEOUT_MS, { data: null, error: "timeout" },
      );
      if (enqErr || !enq?.voice_id) {
        if (current()) becomeUncertain("We couldn't confirm your recording was received. It may already be saved.");
        return;
      }
      updateJobIfSame(key, { ...job, voiceId: enq.voice_id });
      if (!current()) return;
      setPhase("queued");
      startPolling(enq.voice_id, key);
    } finally {
      resumesInFlightRef.current.delete(flight);
    }
  }, [adoptLegacy, becomeUncertain, ctx, findOwnRow, readJob, startPolling, updateJobIfSame]);

  /** Student's explicit choice for an unresolved older marker that never
   * reached the server: it is this work's recording - save it here. */
  const attachLegacyHere = useCallback(() => {
    const l = legacyRef.current;
    if (!l || !legacyCanAttach) return;
    if (!readJob(slot)) writeJob(slot, { ...l.job, voiceId: null, ...ctx });
    if (readJob(slot)?.idempotencyKey === l.job.idempotencyKey) writeJob(l.key, null);
    legacyRef.current = null;
    void resumeStoredJob();
  }, [ctx, legacyCanAttach, readJob, resumeStoredJob, slot, writeJob]);

  /** Student's explicit choice: keep the older marker's details aside (not
   * deleted) and record a new one here. */
  const setLegacyAside = useCallback(() => {
    const l = legacyRef.current;
    if (!l) return;
    safeStore.set(`pl.voiceJob.setAside:${l.job.idempotencyKey}`, l.raw);
    writeJob(l.key, null);
    legacyRef.current = null;
    setPhase("idle");
  }, [writeJob]);

  // Follow a save for this slot that is in flight anywhere on the page. When
  // it finishes, an open dialog resumes from the marker it left (if any).
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
    void resumeStoredJob();
    return () => stopPolling();
  }, [open, resumeStoredJob, stopPolling]);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  /** Step 6D async path: upload, then hand off to the queue and poll for the
   * server's own transcript rather than trusting the browser's. */
  const saveAsync = useCallback(async (blob: Blob, seconds: number, ext: string, audioUrl: string, rec: Recording) => {
    // The server work (upload, marker, enqueue) always runs to the end so the
    // recording is never lost; the screen and the blob URL are only touched
    // while this dialog session - and this exact context - is still current.
    const current = () => epochRef.current!.isCurrent(rec.epoch) && mountedRef.current && slotRef.current === rec.slot;
    // Everything this recording is stored and enqueued with, fixed before any await.
    const path = `${rec.ctx.studentId}/${Date.now()}-explain.${ext}`;
    const job: StoredJob = {
      voiceId: null, idempotencyKey: rec.idempotencyKey, storagePath: path, durationSeconds: seconds, ...rec.ctx,
    };
    if (current()) {
      setPhase("saving");
      setJobStatus(null);
      setJobError(null);
      setScoringPending(false);
    }
    let jobRecorded = false;
    try {
      const { error: upErr } = await supabase.storage
        .from("voice-explanations")
        .upload(path, blob, { contentType: blob.type, upsert: false });
      if (upErr) throw upErr;

      // Written BEFORE the call, under this recording's own slot: if the answer
      // is lost after the server created the job, the key, path and duration
      // are here to find it or retry it identically.
      writeJob(rec.slot, job);
      jobRecorded = true;
      if (current()) {
        // Never restore a URL that close/replacement has already revoked.
        const liveUrl = blobOwnerRef.current!.current === audioUrl ? audioUrl : undefined;
        setSavedResult({ transcript: "", segments: [], score: null, notes: null, audioUrl: liveUrl, storagePath: path });
      }

      const { data: enq, error: enqErr } = await settleWithin(
        supabase.functions
          .invoke("transcription-enqueue", { body: enqueueBody(job, rec.ctx.taskId, rec.ctx.proofId) })
          .then((r) => r, (e) => ({ data: null, error: e })),
        ENQUEUE_TIMEOUT_MS, { data: null, error: "timeout" },
      );
      if (enqErr || !enq?.voice_id) {
        // The request may still have landed - the answer is what was lost.
        // If the dialog closed or moved on meanwhile, the marker stays for the
        // next open of THIS context. ownSave: this save is still registered, so
        // don't wait for itself - otherwise it would stay on "Uploading".
        if (current()) await resumeStoredJob({ ownSave: true });
        return;
      }

      updateJobIfSame(rec.slot, { ...job, voiceId: enq.voice_id });
      if (!current()) return;
      setPhase("queued");
      startPolling(enq.voice_id, rec.slot);
    } catch (err) {
      if (jobRecorded) {
        if (current()) becomeUncertain("We couldn't confirm your recording was received. It may already be saved.");
      } else {
        // Nothing reached the server yet: a fresh attempt is safe, and the
        // local copy of this failed recording is no longer needed.
        if (blobOwnerRef.current!.current === audioUrl) blobOwnerRef.current!.release();
        if (current()) {
          setSavedResult((prev) => withoutLocalAudio(prev));
          setError(err instanceof Error ? err.message : "Could not save the recording.");
          setPhase("error");
        }
      }
    }
  }, [writeJob, updateJobIfSame, startPolling, resumeStoredJob, becomeUncertain]);

  const save = useCallback(async (blob: Blob, spoken: string, segments: TranscriptSegment[], seconds: number, ext: string, rec: Recording) => {
    // Each recording is saved once (a double-click or a duplicate onstop must
    // not upload/enqueue/insert twice); recordings of other contexts - or a
    // newer one here - are never blocked by it.
    if (savedRecordingsRef.current.has(rec.id)) return;
    savedRecordingsRef.current.add(rec.id);
    // Registered page-wide before anything is uploaded, so a closed-and-reopened
    // dialog sees this save in flight even before its recovery marker exists.
    const token = uploadRegistry.begin(rec.slot);
    const current = () => epochRef.current!.isCurrent(rec.epoch) && mountedRef.current && slotRef.current === rec.slot;
    try {
      if (ASYNC_TRANSCRIPTION) {
        // A local copy only if this dialog session is still showing it.
        const url = current() ? blobOwnerRef.current!.adopt(URL.createObjectURL(blob)) : "";
        await saveAsync(blob, seconds, ext, url, rec);
        return;
      }
      if (current()) setPhase("saving");
      const path = `${rec.ctx.studentId}/${Date.now()}-explain.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("voice-explanations")
        .upload(path, blob, { contentType: blob.type, upsert: false });
      if (upErr) throw upErr;

      const words = spoken.trim() ? spoken.trim().split(/\s+/).length : 0;

      const { data: row, error: insErr } = await supabase
        .from("voice_explanations")
        .insert({
          student_id: rec.ctx.studentId,
          task_id: rec.ctx.taskId,
          proof_id: rec.ctx.proofId,
          storage_path: path,
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
      if (words >= MIN_WORDS) {
        const { data: scored } = await supabase.functions.invoke("voice-score", { body: { voice_id: row.id } });
        // A number only when the server actually scored it (not pending/failed).
        score = scoreToShow(scored?.success === true ? "scored" : null, scored?.communication_score);
        notes = scored?.notes ?? null;
      }

      onSavedRef.current?.(); // the row is saved whether or not this dialog is still open
      if (!current()) return; // closed or moved on meanwhile: no blob URL, no screen update
      setSavedResult({ transcript: spoken.trim(), segments, score, notes, audioUrl: blobOwnerRef.current!.adopt(URL.createObjectURL(blob)), storagePath: path });
      setPhase("done");
    } catch (err) {
      if (current()) {
        releaseLocalAudio();
        setError(err instanceof Error ? err.message : "Could not save the recording.");
        setPhase("error");
      }
    } finally {
      uploadRegistry.end(rec.slot, token);
    }
  }, [saveAsync, releaseLocalAudio]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      stopAtRef.current = Date.now();
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(async () => {
    // One Start at a time, and never while a recorder already exists.
    if (startingRef.current || recorderRef.current) return;
    // Never touch the microphone without this student's own consent.
    if (consentRef.current.student !== ctx.studentId || consentRef.current.value !== true) return;
    // A save for this slot still in flight (maybe from a closed dialog): wait for it.
    if (uploadRegistry.isActive(slot)) { waitingForSlotRef.current = true; setPhase("saving"); return; }
    // Never start over a recording the server may still hold (or an older
    // marker not yet matched to other work): resume it. Only an explicit
    // "abandon" / "set aside" (below) clears it first.
    if (ASYNC_TRANSCRIPTION && hasPendingRecovery()) {
      await resumeStoredJob();
      return;
    }
    startingRef.current = true;
    setStarting(true);
    const epoch = epochRef.current!.next(); // a new recording: older continuations are now stale
    // Fixed now, before any await: this recording's context, slot and key.
    const rec: Recording = { id: crypto.randomUUID(), ctx, slot, idempotencyKey: crypto.randomUUID(), epoch };
    setError(null);
    setSecondsLeft(MAX_SECONDS);
    setJobStatus(null);
    setJobError(null);
    setUncertainReason(null);
    setScoringPending(false);
    blobOwnerRef.current?.release(); // the previous recording's local copy
    setSavedResult(null);
    stopAtRef.current = null;

    let stream: MediaStream;
    try {
      stream = await openMic();
    } catch {
      startingRef.current = false;
      if (epochRef.current!.isCurrent(epoch) && mountedRef.current) {
        setStarting(false);
        setError("Microphone blocked. Allow it in your browser and try again.");
        setPhase("error");
      }
      return;
    }
    // Permission can resolve after the dialog closed, unmounted or moved to
    // another context: release the microphone at once and never start a recorder.
    if (!epochRef.current!.isCurrent(epoch) || !mountedRef.current || !openRef.current || slotRef.current !== rec.slot) {
      stream.getTracks().forEach((t) => t.stop());
      startingRef.current = false;
      if (mountedRef.current) setStarting(false);
      return;
    }
    startingRef.current = false;
    setStarting(false);
    streamRef.current = stream;

    let audioCtx: AudioContext | null = null;
    let rec2: MediaRecorder;
    const started = Date.now();
    try {
      // A moving level meter, so it is obvious the microphone is live. A silent
      // dead recorder that looks fine is worse than no recorder.
      audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 60));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      chunksRef.current = [];
      rec2 = makeRecorder(stream);
      recorderRef.current = rec2;
    } catch {
      // The level meter or the recorder could not start on this device:
      // release everything and let the student try again.
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      if (audioCtx) void audioCtx.close().catch(() => {});
      setError("Couldn't start recording on this device. Close other apps using the microphone and try again.");
      setPhase("error");
      return;
    }
    const meterCtx = audioCtx;
    const recorder = rec2;
    const isCurrent = () => epochRef.current!.isCurrent(epoch) && mountedRef.current && slotRef.current === rec.slot;
    recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    recorder.onstop = async () => {
      cleanup();
      void meterCtx.close().catch(() => {});
      // Real elapsed time up to the moment a stop was asked for, capped -
      // never more than the limit, even if a throttled tab stopped it late.
      const seconds = recordedSeconds(started, stopAtRef.current ?? Date.now(), MAX_SECONDS);
      const { type, ext } = recordingFormat(recorder);
      const blob = new Blob(chunksRef.current, { type });
      if (isCurrent()) setPhase(ASYNC_TRANSCRIPTION ? "saving" : "transcribing");

      // The audio itself must not be longer than the limit. A suspended or
      // frozen page can keep capturing while no timer runs, so the capped
      // duration_seconds alone does not bound it. When the browser can
      // measure it and it is too long, nothing is uploaded. (A browser that
      // cannot decode it falls through - see the server-side note in the
      // Step 6 evidence doc.)
      if (audioTooLong(await decodedSeconds(blob), MAX_SECONDS)) {
        if (isCurrent()) {
          setError("This recording ran past 60 seconds while the page was in the background, so it was not saved. Please record again.");
          setPhase("error");
        }
        return;
      }

      if (ASYNC_TRANSCRIPTION) {
        // The whole point of this path: the browser never transcribes at
        // all, Whisper runs once, server-side, after upload+enqueue.
        void save(blob, "", [], seconds, ext, rec);
        return;
      }
      setTranscribeProgress(null);
      transcribeWithTimestamps(blob, setTranscribeProgress)
        .then((r) => save(blob, r.text, r.segments, seconds, ext, rec))
        .catch(() => save(blob, "", [], seconds, ext, rec)); // audio is still saved even if transcription fails
    };
    // A chunk every second, so a recording stopped by the clock or a closed
    // dialog still holds everything said up to that moment.
    try {
      recorder.start(1000);
    } catch {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      void meterCtx.close().catch(() => {});
      setError("Couldn't start recording on this device. Close other apps using the microphone and try again.");
      setPhase("error");
      return;
    }
    recordStartedAtRef.current = started;
    setSecondsLeft(MAX_SECONDS);
    setPhase("recording");
  }, [cleanup, ctx, hasPendingRecovery, resumeStoredJob, save, slot]);

  /** Explicit, student-chosen: forget the uncertain recording and record anew.
   * The earlier one may still finish on the server and appear in the build-log. */
  const abandonAndRecordAgain = useCallback(() => {
    epochRef.current!.next(); // late answers for the abandoned recording are ignored
    stopPolling();
    writeJob(slot, null);
    setJobStatus(null);
    setJobError(null);
    setUncertainReason(null);
    blobOwnerRef.current?.release();
    setSavedResult(null);
    setPhase("idle");
  }, [slot, stopPolling, writeJob]);

  // The clock stops the recording rather than the student. Sixty seconds is the
  // whole point — a longer answer is a written answer read aloud. It is measured
  // from real elapsed time (not a count of timer ticks, which background tabs
  // throttle), re-checked on every tick and on a timer aimed at the deadline.
  // A page that is hidden, left or frozen cannot be trusted to run the clock at
  // all, so the recording is stopped (and saved) at that moment instead.
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
    const { error } = await supabase.rpc("accept_voice_consent").then((r) => r, (e) => ({ error: e as Error }));
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
    legacyRef.current = null;
    setLegacyCanAttach(false);
    cleanup();
    stopPolling();
    releaseLocalAudio();
    setPhase("idle");
  }, [cleanup, stopPolling, releaseLocalAudio]);

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
    // Pick up the NEW context's own job, if any. (The resume-on-open effect
    // above may already have run for it; this reset just cancelled that, so
    // resume again - resumeStoredJob only ever uses this context's marker.)
    if (openRef.current && ASYNC_TRANSCRIPTION) void resumeStoredJob();
  }, [slot, endSession, resumeStoredJob]);

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
                We found an unfinished recording from an earlier visit, but we can't confirm which piece
                of work it belongs to. It has not been deleted.
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
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={setLegacyAside}>
              Keep it aside and record a new one
            </Button>
          </div>
        )}

        {phase === "uncertain" && (
          <div className="space-y-3" data-testid="voice-uncertain">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {uncertainReason} Your recording has not been lost - resume to check on it.
              </AlertDescription>
            </Alert>
            <Button className="w-full" onClick={() => void resumeStoredJob()}>
              <RotateCcw className="h-4 w-4 mr-2" /> Resume existing recording
            </Button>
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={abandonAndRecordAgain}>
              Abandon it and record a new one
            </Button>
            <p className="text-xs text-muted-foreground">
              If you abandon it, the earlier recording may still finish and appear in your build-log.
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
