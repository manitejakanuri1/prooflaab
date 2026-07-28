import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Loader2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const SECONDS_PER_QUESTION = 15;

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

const TimedResumeAssessment = ({ open, onOpenChange, assessmentId, questions, onGraded }: TimedResumeAssessmentProps) => {
  const { toast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_QUESTION);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [answers, setAnswers] = useState<RecordedAnswer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const advancingRef = useRef(false);

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

      onGraded({
        skill_proof_score: data.skill_proof_score,
        resume_quality_score: data.resume_quality_score,
        ats_match_score: data.ats_match_score,
        roadmap: data.roadmap,
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error("Assessment submit failed:", err);
      toast({ title: "Couldn't submit", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [assessmentId, onGraded, onOpenChange, toast]);

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
    if (!open || submitting) return;
    if (timeLeft <= 0) {
      advance();
      return;
    }
    const timer = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, open, submitting, advance]);

  if (!currentQuestion) return null;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-2xl [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
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
      </DialogContent>
    </Dialog>
  );
};

export default TimedResumeAssessment;
