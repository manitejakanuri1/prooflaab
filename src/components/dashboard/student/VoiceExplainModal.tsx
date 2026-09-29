import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  enqueueBody, nextFailures, parseStoredJob, SavedNotifier, viewOf,
  type JobRow, type JobStatus, type PollTick, type StoredJob,
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
 */
type Phase = "idle" | "recording" | "transcribing" | "saving" | "queued" | "done" | "uncertain" | "error";

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
  const [consented, setConsented] = useState<boolean | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [transcribeProgress, setTranscribeProgress] = useState<TranscribeProgress | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [savedResult, setSavedResult] = useState<SavedResult | null>(null);

  // Step 6D/6E/G1 (async path only, see ASYNC_TRANSCRIPTION above).
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [uncertainReason, setUncertainReason] = useState<string | null>(null);
  const [scoringPending, setScoringPending] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailuresRef = useRef(0);
  const checkingRef = useRef(false);        // one progress check at a time
  const resumingRef = useRef(false);        // one resume at a time
  const savingRef = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  // onSaved once per recording per stage, however often polling reports it.
  const notifierRef = useRef<SavedNotifier | null>(null);
  if (!notifierRef.current) notifierRef.current = new SavedNotifier(() => onSavedRef.current?.());

  const jobStorageKey = useCallback(
    () => `pl.voiceJob.${studentId}.${taskId ?? proofId ?? "general"}`,
    [studentId, taskId, proofId],
  );
  const readStoredJob = useCallback((): StoredJob | null => {
    try {
      return parseStoredJob(localStorage.getItem(jobStorageKey()));
    } catch {
      return null;
    }
  }, [jobStorageKey]);
  const writeStoredJob = useCallback((job: StoredJob | null) => {
    try {
      if (job) localStorage.setItem(jobStorageKey(), JSON.stringify(job));
      else localStorage.removeItem(jobStorageKey());
    } catch {
      // Private browsing, or storage blocked - the job still runs server-side
      // and this tab still shows it; only a reload in a fresh tab would miss it.
    }
  }, [jobStorageKey]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);

  /** Recovery details are kept; the student chooses resume or abandon. */
  const becomeUncertain = useCallback((reason: string) => {
    stopPolling();
    setUncertainReason(reason);
    setPhase("uncertain");
  }, [stopPolling]);

  /** One check of the job's current row, shared by the poll loop and by a
   * reopened modal's first look. Reads only this student's own row (RLS
   * scopes every select to student_id = auth.uid()). A failed read or a row
   * that cannot be seen counts as a failure; after MAX_POLL_FAILURES in a
   * row the page stops and asks, instead of spinning forever. */
  const checkJob = useCallback(async (voiceId: string) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      // types.ts predates migrations 41-45 (transcription_status and friends).
      const res = await supabase
        .from("voice_explanations")
        .select("id, transcription_status, transcript, transcript_segments, word_count, transcription_error, status, communication_score, communication_notes, storage_path")
        .eq("id", voiceId)
        .maybeSingle()
        .then((r) => r as unknown as { data: JobRow | null; error: unknown }, (e) => ({ data: null, error: e }));

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
        writeStoredJob(null);
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
        writeStoredJob(null);
      }
      setSavedResult((prev) => ({
        transcript: row.transcript ?? "",
        segments: (row.transcript_segments as TranscriptSegment[] | null) ?? [],
        score: row.communication_score ?? null,
        notes: row.communication_notes ?? null,
        audioUrl: prev?.audioUrl,
        storagePath: row.storage_path ?? prev?.storagePath,
      }));
      setPhase("done");
      notifierRef.current?.notify(voiceId, "transcribed");
      if (view.final) notifierRef.current?.notify(voiceId, "final");
    } finally {
      checkingRef.current = false;
    }
  }, [becomeUncertain, stopPolling, writeStoredJob]);

  /** The recovery path for a lost enqueue response: the job may already
   * exist under this key even though this browser never saw its id. Scoped
   * to the caller's own rows by RLS. `undefined` means the lookup itself
   * failed (unknown), `null` means it genuinely is not there. */
  const findJobByIdempotencyKey = useCallback(async (key: string): Promise<string | null | undefined> => {
    const res = await supabase
      .from("voice_explanations")
      .select("id")
      .eq("transcription_idempotency_key" as "id", key)
      .maybeSingle()
      .then((r) => r as unknown as { data: { id: string } | null; error: unknown }, (e) => ({ data: null, error: e }));
    if (res.error) return undefined;
    return res.data?.id ?? null;
  }, []);

  const startPolling = useCallback((voiceId: string) => {
    stopPolling();
    pollFailuresRef.current = 0;
    void checkJob(voiceId); // don't wait for the first tick to show current state
    pollTimerRef.current = setInterval(() => void checkJob(voiceId), POLL_MS);
  }, [checkJob, stopPolling]);

  /** Resume whatever this student's localStorage says is in flight - on
   * reopen/remount, after a lost enqueue response, or from the "Resume
   * existing recording" button. Known voiceId: just poll. Unknown: ask the
   * server whether the job exists anyway, and only then retry the enqueue -
   * with the SAME idempotency key, storage path and duration. */
  const resumeStoredJob = useCallback(async () => {
    const stored = readStoredJob();
    if (!stored || resumingRef.current) return;
    resumingRef.current = true;
    try {
      idempotencyKeyRef.current = stored.idempotencyKey;
      setError(null);
      setJobError(null);
      setUncertainReason(null);
      // Audio after a refresh comes from the stored file, played through an
      // authenticated download - never an empty URL.
      setSavedResult((prev) => ({
        ...(prev ?? { transcript: "", segments: [], score: null, notes: null }),
        storagePath: stored.storagePath,
      }));

      if (stored.voiceId) {
        setPhase("queued");
        startPolling(stored.voiceId);
        return;
      }

      setPhase("saving");
      const found = await findJobByIdempotencyKey(stored.idempotencyKey);
      if (found) {
        writeStoredJob({ ...stored, voiceId: found });
        setPhase("queued");
        startPolling(found);
        return;
      }

      // Not found, or the lookup failed: retrying the enqueue is still safe
      // (the server reuses the row for the same key), and it is the only way
      // forward if the first call never landed.
      const { data: enq, error: enqErr } = await supabase.functions
        .invoke("transcription-enqueue", { body: enqueueBody(stored, taskId, proofId) })
        .then((r) => r, (e) => ({ data: null, error: e }));
      if (enqErr || !enq?.voice_id) {
        becomeUncertain("We couldn't confirm your recording was received. It may already be saved.");
        return;
      }
      writeStoredJob({ ...stored, voiceId: enq.voice_id });
      setPhase("queued");
      startPolling(enq.voice_id);
    } finally {
      resumingRef.current = false;
    }
  }, [becomeUncertain, findJobByIdempotencyKey, proofId, readStoredJob, startPolling, taskId, writeStoredJob]);

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
  const saveAsync = useCallback(async (blob: Blob, seconds: number, ext: string, audioUrl: string) => {
    setPhase("saving");
    setJobStatus(null);
    setJobError(null);
    setScoringPending(false);
    let jobRecorded = false;
    try {
      const path = `${studentId}/${Date.now()}-explain.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("voice-explanations")
        .upload(path, blob, { contentType: blob.type, upsert: false });
      if (upErr) throw upErr;

      // Stable for retries of THIS recording, fresh for every genuinely new one.
      if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
      const job: StoredJob = {
        voiceId: null, idempotencyKey: idempotencyKeyRef.current, storagePath: path, durationSeconds: seconds,
      };
      // Written BEFORE the call: if the answer is lost after the server
      // created the job, the key, path and duration are here to find it or
      // retry it identically.
      writeStoredJob(job);
      jobRecorded = true;
      setSavedResult({ transcript: "", segments: [], score: null, notes: null, audioUrl, storagePath: path });

      const { data: enq, error: enqErr } = await supabase.functions
        .invoke("transcription-enqueue", { body: enqueueBody(job, taskId, proofId) })
        .then((r) => r, (e) => ({ data: null, error: e }));
      if (enqErr || !enq?.voice_id) {
        // The request may still have landed - the answer is what was lost.
        await resumeStoredJob();
        return;
      }

      writeStoredJob({ ...job, voiceId: enq.voice_id });
      setPhase("queued");
      startPolling(enq.voice_id);
    } catch (err) {
      if (jobRecorded) {
        becomeUncertain("We couldn't confirm your recording was received. It may already be saved.");
      } else {
        // Nothing reached the server yet: a fresh attempt is safe.
        setError(err instanceof Error ? err.message : "Could not save the recording.");
        setPhase("error");
      }
    }
  }, [studentId, taskId, proofId, writeStoredJob, startPolling, resumeStoredJob, becomeUncertain]);

  const save = useCallback(async (blob: Blob, spoken: string, segments: TranscriptSegment[], seconds: number, ext: string) => {
    if (savingRef.current) return; // a double-click or a duplicate onstop must not enqueue/insert twice
    savingRef.current = true;
    try {
      if (ASYNC_TRANSCRIPTION) {
        await saveAsync(blob, seconds, ext, URL.createObjectURL(blob));
        return;
      }
      setPhase("saving");
      const path = `${studentId}/${Date.now()}-explain.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("voice-explanations")
        .upload(path, blob, { contentType: blob.type, upsert: false });
      if (upErr) throw upErr;

      const words = spoken.trim() ? spoken.trim().split(/\s+/).length : 0;

      const { data: row, error: insErr } = await supabase
        .from("voice_explanations")
        .insert({
          student_id: studentId,
          task_id: taskId ?? null,
          proof_id: proofId ?? null,
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
        score = scored?.communication_score ?? null;
        notes = scored?.notes ?? null;
      }

      setSavedResult({ transcript: spoken.trim(), segments, score, notes, audioUrl: URL.createObjectURL(blob), storagePath: path });
      setPhase("done");
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the recording.");
      setPhase("error");
    } finally {
      savingRef.current = false;
    }
  }, [studentId, taskId, proofId, onSaved, saveAsync]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    // Never start over a recording the server may still hold: resume it.
    // Only an explicit "abandon" (below) clears it first.
    if (ASYNC_TRANSCRIPTION && readStoredJob()) {
      await resumeStoredJob();
      return;
    }
    setError(null);
    setSecondsLeft(MAX_SECONDS);
    idempotencyKeyRef.current = null; // a genuinely new recording gets its own key
    setJobStatus(null);
    setJobError(null);
    setUncertainReason(null);
    setScoringPending(false);
    setSavedResult(null);

    let stream: MediaStream;
    try {
      stream = await openMic();
    } catch {
      setError("Microphone blocked. Allow it in your browser and try again.");
      setPhase("error");
      return;
    }
    streamRef.current = stream;

    // A moving level meter, so it is obvious the microphone is live. A silent
    // dead recorder that looks fine is worse than no recorder.
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 60));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    const started = Date.now();
    chunksRef.current = [];
    const rec = makeRecorder(stream);
    recorderRef.current = rec;
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      cleanup();
      void ctx.close();
      const seconds = Math.min(MAX_SECONDS, Math.round((Date.now() - started) / 1000));
      const { type, ext } = recordingFormat(rec);
      const blob = new Blob(chunksRef.current, { type });

      if (ASYNC_TRANSCRIPTION) {
        // The whole point of this path: the browser never transcribes at
        // all, Whisper runs once, server-side, after upload+enqueue.
        void save(blob, "", [], seconds, ext);
        return;
      }
      setPhase("transcribing");
      setTranscribeProgress(null);
      transcribeWithTimestamps(blob, setTranscribeProgress)
        .then((r) => save(blob, r.text, r.segments, seconds, ext))
        .catch(() => save(blob, "", [], seconds, ext)); // audio is still saved even if transcription fails
    };
    // A chunk every second, so a recording stopped by the clock or a closed
    // dialog still holds everything said up to that moment.
    rec.start(1000);
    setPhase("recording");
  }, [cleanup, readStoredJob, resumeStoredJob, save]);

  /** Explicit, student-chosen: forget the uncertain recording and record anew.
   * The earlier one may still finish on the server and appear in the build-log. */
  const abandonAndRecordAgain = useCallback(() => {
    stopPolling();
    writeStoredJob(null);
    idempotencyKeyRef.current = null;
    setJobStatus(null);
    setJobError(null);
    setUncertainReason(null);
    setSavedResult(null);
    setPhase("idle");
  }, [stopPolling, writeStoredJob]);

  // The clock stops the recording rather than the student. Sixty seconds is the
  // whole point — a longer answer is a written answer read aloud.
  useEffect(() => {
    if (phase !== "recording") return;
    if (secondsLeft <= 0) { stop(); return; }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft, stop]);

  // Asked once. After the first yes this query is the only cost.
  useEffect(() => {
    if (!open || !studentId) return;
    let cancelled = false;
    void supabase
      .from("student_profiles")
      .select("voice_consent_at")
      .eq("id", studentId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setConsented(Boolean(data?.voice_consent_at));
      });
    return () => { cancelled = true; };
  }, [open, studentId]);

  const acceptConsent = async () => {
    setAccepting(true);
    const { error } = await supabase.rpc("accept_voice_consent");
    setAccepting(false);
    if (error) {
      toast({ title: "Could not save that", description: error.message, variant: "destructive" });
      return;
    }
    setConsented(true);
  };

  const close = (next: boolean) => {
    if (!next) { cleanup(); stopPolling(); setPhase("idle"); }
    onOpenChange(next);
  };

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
            <Button onClick={() => void start()} className="w-full">
              <Mic className="h-4 w-4 mr-2" /> Start recording
            </Button>
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
                  entries: [{
                    question: prompt,
                    transcript: savedResult.transcript,
                    score: savedResult.score,
                    feedback: savedResult.notes,
                  }],
                }, `explanation-${Date.now()}.pdf`)}
              >
                <FileDown className="h-4 w-4" /> Download PDF
              </Button>
            )}
            <Button className="w-full" onClick={() => close(false)}>Done</Button>
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
                idempotencyKeyRef.current = null;
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
