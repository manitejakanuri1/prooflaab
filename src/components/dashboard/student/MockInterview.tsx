import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Mic, Square, Loader2, AlertTriangle, CheckCircle2, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { transcribeAudio, type TranscribeProgress } from "@/lib/transcribeAudio";

const MAX_SECONDS = 90;

interface PastAnswer { n: number; score: number | null; feedback: string | null }
interface PastInterview {
  id: string; target_role: string | null; overall_score: number | null;
  overall_feedback: string | null; created_at: string; status: string;
  questions: string[]; answers: PastAnswer[];
}

type Phase = "idle" | "generating" | "recording" | "transcribing" | "saving" | "scoring" | "done" | "error";

/**
 * Mock interviews — step 17 of the journey, the one screen the platform never
 * had. Same evidence model as the 60-second explain: the student speaks, the
 * browser writes down what it heard, and the server judges the transcript —
 * except here it is four questions written for their own target role, graded
 * as one conversation rather than four isolated answers.
 */
const MockInterview = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [history, setHistory] = useState<PastInterview[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [transcribeProgress, setTranscribeProgress] = useState<TranscribeProgress | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ overall_score: number; overall_feedback: string } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const loadHistory = useCallback(async (sid: string) => {
    const { data } = await supabase
      .from("mock_interviews")
      .select("id, target_role, overall_score, overall_feedback, created_at, status, questions, answers")
      .eq("student_id", sid)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(10);
    setHistory((data as unknown as PastInterview[]) || []);
    setLoadingHistory(false);
  }, []);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: profile } = await supabase.from("student_profiles")
        .select("id, voice_consent_at").eq("user_id", user.id).maybeSingle();
      if (!profile) { setLoadingHistory(false); return; }
      setStudentId(profile.id);
      setConsented(Boolean(profile.voice_consent_at));
      loadHistory(profile.id);
    })();
  }, [user, loadHistory]);

  const acceptConsent = async () => {
    const { error: err } = await supabase.rpc("accept_voice_consent");
    if (err) { toast({ title: "Could not save that", description: err.message, variant: "destructive" }); return; }
    setConsented(true);
  };

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null; streamRef.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const beginInterview = async () => {
    setPhase("generating");
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke("mock-interview-generate", { body: {} });
      if (err) throw err;
      if (data?.error) throw new Error(data.error);
      setInterviewId(data.interview_id);
      setQuestions(data.questions);
      setQIndex(0);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the interview.");
      setPhase("error");
    }
  };

  const saveAnswer = useCallback(async (blob: Blob, spoken: string, seconds: number) => {
    if (!interviewId || !studentId) return;
    setPhase("saving");
    try {
      const path = `${studentId}/mock-interview/${interviewId}-q${qIndex}.webm`;
      const { error: upErr } = await supabase.storage
        .from("voice-explanations").upload(path, blob, { contentType: "audio/webm", upsert: false });
      if (upErr) throw upErr;

      const { error: rpcErr } = await supabase.rpc("save_mock_interview_answer" as never, {
        _interview_id: interviewId, _storage_path: path,
        _transcript: spoken.trim() || null, _duration_seconds: seconds,
      } as never);
      if (rpcErr) throw rpcErr;

      if (qIndex + 1 < questions.length) {
        setQIndex((i) => i + 1);
        setPhase("idle");
        return;
      }

      setPhase("scoring");
      const { data, error: scoreErr } = await supabase.functions.invoke("mock-interview-score", {
        body: { interview_id: interviewId },
      });
      if (scoreErr) throw scoreErr;
      if (data?.error) throw new Error(data.error);
      setResult({ overall_score: data.overall_score, overall_feedback: data.overall_feedback });
      setPhase("done");
      loadHistory(studentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that answer.");
      setPhase("error");
    }
  }, [interviewId, studentId, qIndex, questions.length, loadHistory]);

  const stop = useCallback(() => {
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null); setSecondsLeft(MAX_SECONDS);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone blocked. Allow it in your browser and try again.");
      setPhase("error");
      return;
    }
    streamRef.current = stream;

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
        .then((text) => saveAnswer(blob, text, seconds))
        .catch(() => saveAnswer(blob, "", seconds));
    };
    rec.start();
    setPhase("recording");
  }, [cleanup, saveAnswer]);

  useEffect(() => {
    if (phase !== "recording") return;
    if (secondsLeft <= 0) { stop(); return; }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft, stop]);

  const reset = () => {
    setPhase("idle"); setInterviewId(null); setQuestions([]); setQIndex(0);
    setResult(null); setError(null);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Mock interview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {consented === false && phase === "idle" && !interviewId && (
            <div className="space-y-3">
              <div className="rounded-lg border p-4 space-y-2">
                <p className="text-sm font-medium">Before you record</p>
                <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
                  <li>Your voice is recorded and stored with your work.</li>
                  <li>It is scored for how you answer — not your accent or your English.</li>
                  <li>Your college can hear it. Nobody outside your college can.</li>
                  <li>You can delete any recording at any time, from Profile → Privacy.</li>
                </ul>
              </div>
              <Button onClick={() => void acceptConsent()}>I understand — continue</Button>
            </div>
          )}

          {consented && phase === "idle" && !interviewId && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground max-w-prose">
                Four questions for your target role, generated fresh each time. Answer each out
                loud, up to {MAX_SECONDS} seconds. Graded as one conversation once all four are in.
              </p>
              <Button onClick={() => void beginInterview()}>
                <Mic className="h-4 w-4 mr-2" /> Start mock interview
              </Button>
            </div>
          )}

          {phase === "generating" && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Writing your questions…
            </div>
          )}

          {interviewId && questions.length > 0 &&
            (phase === "idle" || phase === "recording" || phase === "transcribing" || phase === "saving") && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline">Question {qIndex + 1} of {questions.length}</Badge>
              </div>
              <p className="text-sm font-medium">{questions[qIndex]}</p>

              {phase === "idle" && (
                <Button onClick={start} className="w-full">
                  <Mic className="h-4 w-4 mr-2" /> Answer
                </Button>
              )}

              {phase === "recording" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold tabular-nums">{secondsLeft}s</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-destructive transition-[width] duration-100"
                           style={{ width: `${Math.round(level * 100)}%` }} />
                    </div>
                  </div>
                  <Button variant="destructive" onClick={stop} className="w-full">
                    <Square className="h-4 w-4 mr-2" /> Stop and save answer
                  </Button>
                </div>
              )}

              {phase === "transcribing" && (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {transcribeProgress?.stage === "loading"
                    ? `Preparing (first time only)… ${transcribeProgress.percent ?? 0}%`
                    : "Writing down what you said…"}
                </div>
              )}

              {phase === "saving" && (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving your answer…
                </div>
              )}
            </div>
          )}

          {phase === "scoring" && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Grading the interview…
            </div>
          )}

          {phase === "done" && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="text-2xl font-bold tabular-nums">{result.overall_score}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <p className="text-sm">{result.overall_feedback}</p>
              <Button variant="outline" onClick={reset}>Take another</Button>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-3">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              <Button variant="outline" onClick={reset}>Start over</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Past interviews</CardTitle></CardHeader>
        <CardContent>
          {loadingHistory ? (
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="rounded-lg border p-3">
                  <button
                    className="flex w-full items-center justify-between gap-2 text-left"
                    onClick={() => setExpandedId(expandedId === h.id ? null : h.id)}
                  >
                    <span className="text-sm">
                      {h.target_role || "Mock interview"} ·{" "}
                      {new Date(h.created_at).toLocaleDateString()}
                    </span>
                    <Badge variant={h.overall_score != null && h.overall_score >= 70 ? "default" : "secondary"}>
                      {h.overall_score ?? "—"}/100
                    </Badge>
                  </button>
                  {expandedId === h.id && (
                    <div className="mt-2 space-y-2 text-sm">
                      <p className="text-muted-foreground">{h.overall_feedback}</p>
                      {h.questions.map((q, i) => {
                        const a = h.answers.find((x) => x.n === i);
                        return (
                          <div key={i} className="border-t pt-2">
                            <p className="font-medium">{q}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {a?.score ?? "—"}/100 — {a?.feedback ?? "not scored"}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MockInterview;
