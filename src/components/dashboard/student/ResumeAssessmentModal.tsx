import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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

interface ResumeAssessmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  questions: Question[];
  onGraded: (result: ResumeScoreResult) => void;
}

const ResumeAssessmentModal = ({ open, onOpenChange, assessmentId, questions, onGraded }: ResumeAssessmentModalProps) => {
  const { toast } = useToast();
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, number>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const answeredCount =
    Object.keys(mcqAnswers).length + Object.values(textAnswers).filter((t) => t.trim().length > 0).length;

  const handleSubmit = async () => {
    const answers = questions.map((q) => ({
      question_id: q.id,
      answer_text: q.type === "mcq" ? (q.options?.[mcqAnswers[q.id]] ?? "") : (textAnswers[q.id] || ""),
      ...(q.type === "mcq" ? { selected_index: mcqAnswers[q.id] } : {}),
    }));

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("resume-assessment-submit", {
        body: { assessment_id: assessmentId, answers },
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
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prove your resume</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 mb-2">
          <Progress value={(answeredCount / questions.length) * 100} />
          <p className="text-xs text-muted-foreground">{answeredCount} / {questions.length} answered</p>
        </div>

        <div className="space-y-6">
          {questions.map((q, i) => (
            <div key={q.id} className="space-y-2">
              <p className="font-medium text-sm">
                {i + 1}. {q.prompt}
              </p>
              {q.type === "mcq" ? (
                <RadioGroup
                  value={mcqAnswers[q.id]?.toString()}
                  onValueChange={(v) => setMcqAnswers({ ...mcqAnswers, [q.id]: parseInt(v, 10) })}
                >
                  {q.options?.map((opt, idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <RadioGroupItem value={idx.toString()} id={`${q.id}-${idx}`} />
                      <Label htmlFor={`${q.id}-${idx}`} className="text-sm font-normal cursor-pointer">
                        {opt}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <Textarea
                  value={textAnswers[q.id] || ""}
                  onChange={(e) => setTextAnswers({ ...textAnswers, [q.id]: e.target.value })}
                  placeholder="Explain in your own words..."
                  rows={3}
                />
              )}
            </div>
          ))}
        </div>

        <Button onClick={handleSubmit} disabled={submitting || answeredCount === 0} className="w-full mt-4">
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Grading...
            </>
          ) : (
            "Submit assessment"
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default ResumeAssessmentModal;
