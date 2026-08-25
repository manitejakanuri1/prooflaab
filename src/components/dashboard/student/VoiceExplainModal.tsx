import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mic, Square, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { transcribeAudio, type TranscribeProgress } from "@/lib/transcribeAudio";

const MAX_SECONDS = 60;

/**
 * Minimum words before the recording is worth scoring. Sixty seconds of near
 * silence is not an explanation, and sending it to be graded would produce a
 * confident score for nothing.
 */
const MIN_WORDS = 12;

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

type Phase = "idle" | "recording" | "transcribing" | "saving" | "done" | "error";

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

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const save = useCallback(async (blob: Blob, spoken: string, seconds: number) => {
    setPhase("saving");
    try {
      const path = `${studentId}/${Date.now()}-explain.webm`;
      const { error: upErr } = await supabase.storage
        .from("voice-explanations")
        .upload(path, blob, { contentType: "audio/webm", upsert: false });
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
          word_count: words,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      // Scoring runs on the server. A short or missing transcript is saved
      // anyway — the audio is the evidence, and a human can still listen.
      if (words >= MIN_WORDS) {
        await supabase.functions.invoke("voice-score", { body: { voice_id: row.id } });
      }

      setPhase("done");
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the recording.");
      setPhase("error");
    }
  }, [studentId, taskId, proofId, onSaved]);

  const stop = useCallback(() => {
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setSecondsLeft(MAX_SECONDS);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    const rec = new MediaRecorder(stream);
    recorderRef.current = rec;
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      cleanup();
      void ctx.close();
      const seconds = Math.min(MAX_SECONDS, Math.round((Date.now() - started) / 1000));
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });

      setPhase("transcribing");
      setTranscribeProgress(null);
      transcribeAudio(blob, setTranscribeProgress)
        .then((text) => save(blob, text, seconds))
        .catch(() => save(blob, "", seconds)); // audio is still saved even if transcription fails
    };
    rec.start();
    setPhase("recording");
  }, [cleanup, save]);

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
            <Loader2 className="h-4 w-4 animate-spin" /> Saving your explanation…
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-3 py-2">
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Saved. It will appear in your build-log.
            </p>
            <Button className="w-full" onClick={() => close(false)}>Done</Button>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button variant="outline" className="w-full" onClick={() => setPhase("idle")}>
              Try again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default VoiceExplainModal;
