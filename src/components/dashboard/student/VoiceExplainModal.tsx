import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mic, Square, AlertTriangle, CheckCircle2, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { transcribeWithTimestamps, type TranscribeProgress, type TranscriptSegment } from "@/lib/transcribeAudio";
import { openMic, makeRecorder, recordingFormat } from "@/lib/recordAudio";
import RecordingPlayback from "./RecordingPlayback";
import { exportTranscriptPdf } from "@/lib/exportTranscriptPdf";

const MAX_SECONDS = 60;

/**
 * Minimum words before the recording is worth scoring. Sixty seconds of near
 * silence is not an explanation, and sending it to be graded would produce a
 * confident score for nothing.
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

type JobStatus = "pending" | "processing" | "completed" | "failed";

/** What a resumable in-flight job looks like in localStorage - just enough
 * to recover it after a close/reopen or a page refresh, never the transcript
 * itself (that always comes back from the server, never from the browser's
 * own storage). */
interface StoredJob {
  voiceId: string;
  idempotencyKey: string;
  storagePath: string;
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

type Phase = "idle" | "recording" | "transcribing" | "saving" | "queued" | "done" | "error";

/**
 * Consent, asked once and remembered.
 *
 * The platform keeps a recording of the student's voice, a transcript of it and
 * a judgement about how clearly they explain things. Storing that without ever
 * asking, and with no way to take it back, is the kind of thing nobody notices
 * until a parent or a college's legal team asks about it.
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
  const [savedResult, setSavedResult] = useState<
    { transcript: string; segments: TranscriptSegment[]; score: number | null; notes: string | null; audioUrl: string } | null
  >(null);

  // Step 6D (async path only, see ASYNC_TRANSCRIPTION above).
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const savingRef = useRef(false);

  const jobStorageKey = useCallback(
    () => `pl.voiceJob.${studentId}.${taskId ?? proofId ?? "general"}`,
    [studentId, taskId, proofId],
  );
  const readStoredJob = useCallback((): StoredJob | null => {
    try {
      const raw = localStorage.getItem(jobStorageKey());
      return raw ? (JSON.parse(raw) as StoredJob) : null;
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

  /** One check of the job's current row, shared by the poll loop and by a
   * reopened modal's first look - both need the exact same "what do I show
   * right now" logic. Reads only this student's own row (RLS scopes every
   * select to student_id = auth.uid()), never another student's. */
  const checkJob = useCallback(async (voiceId: string) => {
    // types.ts predates migrations 41-43 (transcription_status and friends),
    // same reason the sync insert below already casts transcript_segments.
    const { data: row, error } = await supabase
      .from("voice_explanations")
      .select("id, transcription_status, transcript, transcript_segments, word_count, transcription_error")
      .eq("id", voiceId)
      .maybeSingle()
      .then((r) => r as unknown as {
        data: {
          id: string;
          transcription_status: JobStatus | null;
          transcript: string | null;
          transcript_segments: TranscriptSegment[] | null;
          word_count: number | null;
          transcription_error: string | null;
        } | null;
        error: unknown;
      });
    if (error || !row) return;

    const status = (row.transcription_status ?? "pending") as JobStatus;
    setJobStatus(status);

    if (status === "completed") {
      stopPolling();
      writeStoredJob(null);
      const transcript = row.transcript ?? "";
      const words = row.word_count ?? 0;
      let score: number | null = null;
      let notes: string | null = null;
      // Never graded before the transcript exists - status only reaches
      // 'completed' once the worker has written it back (migration 42's
      // complete_transcription_job), so this is the earliest safe moment.
      if (words >= MIN_WORDS) {
        const { data: scored } = await supabase.functions.invoke("voice-score", { body: { voice_id: voiceId } });
        score = scored?.communication_score ?? null;
        notes = scored?.notes ?? null;
      }
      setSavedResult((prev) => ({
        transcript,
        segments: (row.transcript_segments as TranscriptSegment[] | null) ?? [],
        score,
        notes,
        audioUrl: prev?.audioUrl ?? "",
      }));
      setPhase("done");
      onSaved?.();
    } else if (status === "failed") {
      stopPolling();
      writeStoredJob(null);
      setJobError(row.transcription_error || "Could not transcribe this recording.");
      setPhase("error");
    }
  }, [onSaved, stopPolling, writeStoredJob]);

  const startPolling = useCallback((voiceId: string) => {
    stopPolling();
    void checkJob(voiceId); // don't wait for the first tick to show current state
    pollTimerRef.current = setInterval(() => void checkJob(voiceId), 2500);
  }, [checkJob, stopPolling]);

  // Reopening the modal (or a fresh mount after a page refresh) recovers an
  // existing job instead of offering to start a new recording over it.
  useEffect(() => {
    if (!open || !ASYNC_TRANSCRIPTION) return;
    const stored = readStoredJob();
    if (!stored) return;
    setPhase("queued");
    startPolling(stored.voiceId);
    return () => stopPolling();
  }, [open, readStoredJob, startPolling, stopPolling]);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  /** Step 6D async path: upload, then hand off to the queue and poll for the
   * server's own transcript rather than trusting the browser's. A
   * browser-supplied transcript is not server-verified - transcript_source
   * and the migration 43 insert guard are what actually distinguish the two,
   * not this modal's choice of which button the student pressed. */
  const saveAsync = useCallback(async (blob: Blob, seconds: number, ext: string, audioUrl: string) => {
    setPhase("saving");
    setJobStatus(null);
    setJobError(null);
    try {
      const path = `${studentId}/${Date.now()}-explain.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("voice-explanations")
        .upload(path, blob, { contentType: blob.type, upsert: false });
      if (upErr) throw upErr;

      // Stable for retries of THIS recording (a network blip before the
      // enqueue call lands), fresh for every genuinely new one - start()
      // clears this ref, so a re-record always gets a new key.
      if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
      const idempotencyKey = idempotencyKeyRef.current;

      const { data: enq, error: enqErr } = await supabase.functions.invoke("transcription-enqueue", {
        body: {
          storage_path: path,
          task_id: taskId ?? null,
          proof_id: proofId ?? null,
          duration_seconds: seconds,
          idempotency_key: idempotencyKey,
        },
      });
      if (enqErr || !enq?.voice_id) throw new Error(enqErr?.message || "Could not queue this recording.");

      writeStoredJob({ voiceId: enq.voice_id, idempotencyKey, storagePath: path });
      setSavedResult((prev) => ({ ...(prev ?? { transcript: "", segments: [], score: null, notes: null }), audioUrl }));
      setPhase("queued");
      startPolling(enq.voice_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the recording.");
      setPhase("error");
    }
  }, [studentId, taskId, proofId, writeStoredJob, startPolling]);

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

      setSavedResult({ transcript: spoken.trim(), segments, score, notes, audioUrl: URL.createObjectURL(blob) });
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
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setSecondsLeft(MAX_SECONDS);
    // A genuinely new recording, never a retry of one already in flight -
    // it gets its own idempotency key, and any job left over from a
    // previous failed attempt for this task/proof is no longer relevant.
    idempotencyKeyRef.current = null;
    setJobStatus(null);
    setJobError(null);
    writeStoredJob(null);

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
  }, [cleanup, save, writeStoredJob]);

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
    if (!next) { cleanup(); setPhase("idle"); }
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
                <li>Your college can hear it. Nobody outside your college can.</li>
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
            <Button onClick={start} className="w-full">
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
                <RecordingPlayback src={savedResult.audioUrl} transcript={savedResult.transcript}
                                   segments={savedResult.segments} />
                {savedResult.score != null && (
                  <p className="mt-2 text-sm font-medium">Communication score {savedResult.score}/100</p>
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

        {phase === "error" && (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{jobError ?? error}</AlertDescription>
            </Alert>
            <Button
              variant="outline" className="w-full"
              onClick={() => {
                writeStoredJob(null);
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
