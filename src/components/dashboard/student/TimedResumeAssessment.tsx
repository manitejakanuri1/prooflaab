import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Loader2, Clock, Mic, Square, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const SECONDS_PER_QUESTION = 15;
const MAX_RECORDING_SECONDS = 90;

interface Question {
  id: string;
  type: "mcq" | "short_answer";
  prompt: string;
  options?: string[];
}

export interface ResumeScoreResult {
  skill_proof_score: number;
  resume_quality_score: number | null;
  ats_match_score: number | null;
  roadmap: string;
  voice_authenticity_score?: number | null;
  voice_notes?: string | null;
}

interface TimedResumeAssessmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  questions: Question[];
  onGraded: (result: ResumeScoreResult) => void;
}

interface RecordedAnswer {
  question_id: string;
  answer_text: string;
  selected_index?: number;
}

type Phase = "quiz" | "recording" | "analyzing";

const TimedResumeAssessment = ({ open, onOpenChange, assessmentId, questions, onGraded }: TimedResumeAssessmentProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_QUESTION);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [answers, setAnswers] = useState<RecordedAnswer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const advancingRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("quiz");
  const [pendingResult, setPendingResult] = useState<ResumeScoreResult | null>(null);
  const [scorecardId, setScorecardId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;

  const submitAssessment = useCallback(async (finalAnswers: RecordedAnswer[]) => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-assessment-submit", {
        body: { assessment_id: assessmentId, answers: finalAnswers },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setPendingResult({
        skill_proof_score: data.skill_proof_score,
        resume_quality_score: data.resume_quality_score,
        ats_match_score: data.ats_match_score,
        roadmap: data.roadmap,
      });
      setScorecardId(data.scorecard_id);
      setPhase("recording");
    } catch (err: any) {
      console.error("Assessment submit failed:", err);
      toast({ title: "Couldn't submit", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [assessmentId, toast]);

  const advance = useCallback(() => {
    if (advancingRef.current || !currentQuestion) return;
    advancingRef.current = true;

    const recorded: RecordedAnswer = {
      question_id: currentQuestion.id,
      answer_text: currentQuestion.type === "mcq"
        ? (selectedOption !== null ? currentQuestion.options?.[selectedOption] ?? "" : "")
        : textAnswer,
      ...(currentQuestion.type === "mcq" && selectedOption !== null ? { selected_index: selectedOption } : {}),
    };
    const nextAnswers = [...answers, recorded];
    setAnswers(nextAnswers);

    if (isLastQuestion) {
      submitAssessment(nextAnswers);
      return;
    }

    setCurrentIndex((i) => i + 1);
    setSelectedOption(null);
    setTextAnswer("");
    setTimeLeft(SECONDS_PER_QUESTION);
    advancingRef.current = false;
  }, [answers, currentQuestion, isLastQuestion, selectedOption, textAnswer, submitAssessment]);

  useEffect(() => {
    if (!open || submitting || phase !== "quiz") return;
    if (timeLeft <= 0) {
      advance();
      return;
    }
    const timer = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, open, submitting, phase, advance]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
      };
      recorder.start();
      setRecordedBlob(null);
      setRecordedSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordedSeconds((s) => {
          if (s + 1 >= MAX_RECORDING_SECONDS) {
            stopRecording();
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      console.error("Microphone access failed:", err);
      toast({ title: "Couldn't access microphone", description: "Please allow microphone access and try again.", variant: "destructive" });
    }
  };

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  const submitExplanation = async () => {
    if (!recordedBlob || !user || !scorecardId || !pendingResult) return;
    setPhase("analyzing");
    try {
      const storagePath = `${user.id}/${assessmentId}-${Date.now()}.webm`;
      const { error: uploadError } = await supabase.storage
        .from("voice-explanations")
        .upload(storagePath, recordedBlob, { upsert: false, contentType: "audio/webm" });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase.functions.invoke("resume-voice-verify", {
        body: { scorecard_id: scorecardId, storage_path: storagePath, mime_type: "audio/webm" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      onGraded({
        ...pendingResult,
        voice_authenticity_score: data.voice_authenticity_score,
        voice_notes: data.voice_notes,
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error("Voice verification failed:", err);
      toast({ title: "Couldn't verify recording", description: err.message || "Please try again.", variant: "destructive" });
      setPhase("recording");
    }
  };

  if (phase === "quiz" && !currentQuestion) return null;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-2xl [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {phase === "quiz" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>Prove your resume</span>
                <span className={`flex items-center gap-1 text-sm font-normal ${timeLeft <= 5 ? "text-destructive" : "text-muted-foreground"}`}>
                  <Clock className="h-4 w-4" /> {timeLeft}s
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-1 mb-2">
              <Progress value={(currentIndex / questions.length) * 100} />
              <p className="text-xs text-muted-foreground">Question {currentIndex + 1} of {questions.length}</p>
            </div>

            <div className="space-y-4" key={currentQuestion.id}>
              <p className="font-medium">{currentQuestion.prompt}</p>

              {currentQuestion.type === "mcq" ? (
                <RadioGroup
                  value={selectedOption !== null ? selectedOption.toString() : ""}
                  onValueChange={(v) => setSelectedOption(parseInt(v, 10))}
                >
                  {currentQuestion.options?.map((opt, idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <RadioGroupItem value={idx.toString()} id={`opt-${idx}`} />
                      <Label htmlFor={`opt-${idx}`} className="text-sm font-normal cursor-pointer">
                        {opt}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <Textarea
                  value={textAnswer}
                  onChange={(e) => setTextAnswer(e.target.value)}
                  placeholder="Explain in your own words..."
                  rows={4}
                  autoFocus
                />
              )}
            </div>

            <Button onClick={advance} disabled={submitting} className="w-full mt-4">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Grading...
                </>
              ) : isLastQuestion ? (
                "Finish"
              ) : (
                "Next"
              )}
            </Button>
          </>
        )}

        {phase === "recording" && (
          <>
            <DialogHeader>
              <DialogTitle>Explain your answers</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              In your own voice, explain why you chose the answers you did. This is how we confirm they weren't a guess.
            </p>

            <div className="flex flex-col items-center gap-4 py-6">
              {!isRecording && !recordedBlob && (
                <Button onClick={startRecording} size="lg" className="rounded-full h-16 w-16 p-0">
                  <Mic className="h-6 w-6" />
                </Button>
              )}
              {isRecording && (
                <>
                  <Button onClick={stopRecording} size="lg" variant="destructive" className="rounded-full h-16 w-16 p-0 animate-pulse">
                    <Square className="h-6 w-6" />
                  </Button>
                  <p className="text-sm text-muted-foreground">Recording... {recordedSeconds}s</p>
                </>
              )}
              {!isRecording && recordedBlob && (
                <>
                  <audio controls src={URL.createObjectURL(recordedBlob)} className="w-full" />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={startRecording}>
                      <Mic className="h-4 w-4 mr-2" /> Re-record
                    </Button>
                  </div>
                </>
              )}
            </div>

            <Button onClick={submitExplanation} disabled={!recordedBlob} className="w-full">
              <Play className="h-4 w-4 mr-2" /> Submit explanation
            </Button>
          </>
        )}

        {phase === "analyzing" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm text-muted-foreground">Analyzing your explanation...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TimedResumeAssessment;
