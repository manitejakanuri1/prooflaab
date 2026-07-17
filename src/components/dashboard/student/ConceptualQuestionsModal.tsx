import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, Clock, Send, Brain, CheckCircle2, XCircle, GraduationCap } from "lucide-react";

interface Question {
  id: string;
  prompt: string;
  options?: string[];
  correct_index?: number;
  reinforce?: string;
  teach?: string;
  context_references?: string[];
  difficulty?: string;
  time_limit_seconds?: number;
}

interface ConceptualQuestionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proofId: string;
  onSubmitSuccess?: () => void;
  /** Show a read-only review of a graded quiz instead of running it */
  review?: boolean;
}

// ponytail: correct_index/reinforce/teach ride along in the questions payload
// the client fetches, so devtools can reveal answers mid-quiz. Ceiling accepted
// for MVP; upgrade path = serve questions through a view that strips them and
// grade purely server-side.
const ConceptualQuestionsModal = ({
  open,
  onOpenChange,
  proofId,
  onSubmitSuccess,
  review = false
}: ConceptualQuestionsModalProps) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedIndexes, setSelectedIndexes] = useState<Record<string, number | null>>({});
  const [phase, setPhase] = useState<'question' | 'feedback' | 'results' | 'review'>('question');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const { toast } = useToast();

  const isMcq = questions.length > 0 && questions.every(q => Array.isArray(q.options) && typeof q.correct_index === 'number');

  // Fetch questions when modal opens
  useEffect(() => {
    if (open && proofId) {
      setCurrentIndex(0);
      setAnswers({});
      setSelectedIndexes({});
      setPhase(review ? 'review' : 'question');
      setShowConfirmation(false);
      fetchQuestions();
    }
  }, [open, proofId, review]);

  // Lock the current MCQ answer and show feedback (called on pick or timeout)
  const lockMcqAnswer = useCallback((index: number | null) => {
    const q = questions[currentIndex];
    if (!q) return;
    setSelectedIndexes(prev => ({ ...prev, [q.id]: index }));
    setTimeLeft(null);
    setPhase('feedback');
  }, [questions, currentIndex]);

  // Timer countdown; hitting zero on an MCQ question locks a "no answer"
  useEffect(() => {
    if (timeLeft === null || phase !== 'question') return;
    if (timeLeft <= 0) {
      if (isMcq) lockMcqAnswer(null);
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft(prev => (prev === null ? null : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, phase, isMcq, lockMcqAnswer]);

  // Start timer when a question is shown
  useEffect(() => {
    if (questions.length > 0 && currentIndex < questions.length && phase === 'question') {
      const currentQuestion = questions[currentIndex];
      setTimeLeft(currentQuestion.time_limit_seconds ?? (isMcq ? 15 : 120));
    }
  }, [currentIndex, questions, phase, isMcq]);

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('conceptual_tests')
        .select('questions, student_answers')
        .eq('proof_id', proofId)
        .single();

      if (error) throw error;

      if (data?.questions && Array.isArray(data.questions)) {
        setQuestions(data.questions as unknown as Question[]);
      }
      if (review && Array.isArray(data?.student_answers)) {
        const past: Record<string, number | null> = {};
        for (const a of data.student_answers as { question_id: string; selected_index?: number }[]) {
          past[a.question_id] = typeof a.selected_index === 'number' && a.selected_index >= 0 ? a.selected_index : null;
        }
        setSelectedIndexes(past);
      }
    } catch (error) {
      console.error('Error fetching questions:', error);
      toast({
        title: "Error",
        description: "Failed to load questions",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (value: string) => {
    const currentQuestion = questions[currentIndex];
    setAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: value
    }));
  };

  const handleFeedbackNext = () => {
    if (currentIndex < questions.length - 1) {
      setPhase('question');
      setCurrentIndex(prev => prev + 1);
    } else {
      setPhase('results');
      handleSubmit();
    }
  };

  const handleNext = () => {
    const currentAnswer = answers[questions[currentIndex].id] || "";
    if (currentAnswer.trim().length < 100) {
      toast({
        title: "Answer too short",
        description: "Please provide at least 100 characters",
        variant: "destructive"
      });
      return;
    }

    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setShowConfirmation(true);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const answersArray = questions.map(q => {
        if (isMcq) {
          const sel = selectedIndexes[q.id];
          return {
            question_id: q.id,
            answer_text: typeof sel === 'number' ? (q.options?.[sel] ?? '') : 'No answer (time expired)',
            selected_index: typeof sel === 'number' ? sel : -1
          };
        }
        return {
          question_id: q.id,
          answer_text: answers[q.id] || ""
        };
      });

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Not authenticated");
      }

      const response = await supabase.functions.invoke('submit-conceptual-answers', {
        body: {
          proof_id: proofId,
          answers: answersArray
        }
      });

      if (response.error) throw response.error;

      if (isMcq) {
        // Results screen is already showing — just refresh parent data
        onSubmitSuccess?.();
        return;
      }

      toast({
        title: "Success! 🎉",
        description: "Answers submitted successfully — verification will continue automatically."
      });

      onOpenChange(false);
      if (onSubmitSuccess) {
        onSubmitSuccess();
      }
    } catch (error) {
      console.error('Error submitting answers:', error);
      toast({
        title: "Submission Failed",
        description: error.message || "Please try again",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[600px] rounded-2xl">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (questions.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[600px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              🧠 Conceptual Verification
            </DialogTitle>
            <DialogDescription>
              No questions available for this proof.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers[currentQuestion.id] || "";
  const progress = ((currentIndex + 1) / questions.length) * 100;

  // ---- MCQ flow: timed question, then instant feedback ----
  if (isMcq) {
    const selected = selectedIndexes[currentQuestion.id];
    const isCorrect = typeof selected === 'number' && selected === currentQuestion.correct_index;
    const isLast = currentIndex === questions.length - 1;

    if (phase === 'review') {
      const correctCount = questions.filter(q => selectedIndexes[q.id] === q.correct_index).length;
      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-[600px] max-h-[85vh] overflow-y-auto rounded-2xl shadow-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5" />
                Quiz Review — {correctCount} / {questions.length}
              </DialogTitle>
              <DialogDescription>
                Reread what each question was really about — especially the ones you missed.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {questions.map((q, i) => {
                const sel = selectedIndexes[q.id];
                const right = sel === q.correct_index;
                return (
                  <div key={q.id} className="border rounded-lg p-4 space-y-2">
                    <p className="font-medium flex items-start gap-2">
                      {right
                        ? <CheckCircle2 className="h-4 w-4 mt-1 text-green-600 shrink-0" />
                        : <XCircle className="h-4 w-4 mt-1 text-red-600 shrink-0" />}
                      <span>Q{i + 1}. {q.prompt}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Your answer: {typeof sel === 'number'
                        ? `${String.fromCharCode(65 + sel)}. ${q.options?.[sel]}`
                        : 'No answer (time expired)'}
                    </p>
                    {!right && (
                      <p className="text-sm">
                        Correct: <span className="font-medium">
                          {String.fromCharCode(65 + (q.correct_index ?? 0))}. {q.options?.[q.correct_index ?? 0]}
                        </span>
                      </p>
                    )}
                    {(right ? q.reinforce : q.teach) && (
                      <div className="bg-muted/50 rounded-md p-3 text-sm text-muted-foreground whitespace-pre-line">
                        {right ? q.reinforce : q.teach}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex justify-end">
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    if (phase === 'results') {
      const correctCount = questions.filter(q => selectedIndexes[q.id] === q.correct_index).length;
      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-[600px] rounded-2xl shadow-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Quiz Results
              </DialogTitle>
              <DialogDescription>
                {submitting ? "Saving your answers..." : "Your answers are saved — verification continues automatically."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="text-center py-2">
                <p className="text-4xl font-bold">
                  {correctCount} / {questions.length}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {correctCount === questions.length
                    ? "Perfect — you know your code!"
                    : correctCount > 0
                      ? "Good — reread the explanations for the ones you missed."
                      : "Go through your code once more — the explanations above tell you where to start."}
                </p>
              </div>

              <div className="space-y-2">
                {questions.map((q, i) => {
                  const right = selectedIndexes[q.id] === q.correct_index;
                  return (
                    <div key={q.id} className="flex items-start gap-2 text-sm p-2 rounded-md bg-muted/50">
                      {right
                        ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
                        : <XCircle className="h-4 w-4 mt-0.5 text-red-600 shrink-0" />}
                      <span className="text-muted-foreground">Q{i + 1}. {q.prompt}</span>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <Button onClick={() => onOpenChange(false)} disabled={submitting}>
                  Done
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[600px] rounded-2xl shadow-lg" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              🧠 Do You Know Your Code?
            </DialogTitle>
            <DialogDescription>
              Quick questions about the code you submitted — {currentQuestion.time_limit_seconds ?? 15}s each
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">
                  Question {currentIndex + 1} of {questions.length}
                </span>
                {phase === 'question' && timeLeft !== null && (
                  <Badge variant={timeLeft <= 5 ? "destructive" : "secondary"} className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {timeLeft}s
                  </Badge>
                )}
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              {currentQuestion.difficulty && (
                <Badge variant="outline">{currentQuestion.difficulty}</Badge>
              )}
              <p className="font-medium text-foreground leading-relaxed">
                {currentQuestion.prompt}
              </p>
            </div>

            {phase === 'question' ? (
              <div className="space-y-2">
                {currentQuestion.options!.map((opt, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    className="w-full justify-start text-left h-auto py-3 whitespace-normal"
                    onClick={() => lockMcqAnswer(idx)}
                  >
                    <span className="font-semibold mr-2">{String.fromCharCode(65 + idx)}.</span>
                    {opt}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {isCorrect ? (
                  <div className="border border-green-300 bg-green-50 dark:bg-green-950/20 p-4 rounded-lg space-y-2">
                    <p className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-5 w-5" />
                      Correct!
                    </p>
                    {currentQuestion.reinforce && (
                      <p className="text-sm text-foreground">{currentQuestion.reinforce}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="border border-red-300 bg-red-50 dark:bg-red-950/20 p-4 rounded-lg space-y-2">
                      <p className="flex items-center gap-2 font-medium text-red-700 dark:text-red-400">
                        <XCircle className="h-5 w-5" />
                        {typeof selected === 'number' ? 'Not quite' : "Time's up"}
                      </p>
                      <p className="text-sm text-foreground">
                        Correct answer: <span className="font-medium">
                          {String.fromCharCode(65 + (currentQuestion.correct_index ?? 0))}. {currentQuestion.options![currentQuestion.correct_index ?? 0]}
                        </span>
                      </p>
                    </div>
                    {currentQuestion.teach && (
                      <div className="border bg-muted/50 p-4 rounded-lg space-y-2">
                        <p className="flex items-center gap-2 font-medium text-foreground">
                          <GraduationCap className="h-5 w-5" />
                          Understand your code
                        </p>
                        <p className="text-sm text-muted-foreground whitespace-pre-line">{currentQuestion.teach}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button onClick={handleFeedbackNext} disabled={submitting}>
                    {submitting ? "Submitting..." : isLast ? (
                      <>
                        <Send className="h-4 w-4 mr-1" />
                        Finish
                      </>
                    ) : (
                      <>
                        Next Question
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- Legacy free-text flow (older tests generated before MCQ) ----
  if (showConfirmation) {
    const allAnswered = questions.every(q => answers[q.id]?.trim().length >= 100);

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[600px] rounded-2xl shadow-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Confirm Submission
            </DialogTitle>
            <DialogDescription>
              You've answered all questions. Ready to submit?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <p className="font-medium">Summary:</p>
              <p className="text-sm text-muted-foreground">
                Total Questions: {questions.length}
              </p>
              <p className="text-sm text-muted-foreground">
                Answered: {Object.keys(answers).length}
              </p>
              {!allAnswered && (
                <p className="text-sm text-destructive">
                  ⚠️ Some answers are too short (min 100 chars)
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowConfirmation(false)}
                disabled={submitting}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to Review
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!allAnswered || submitting}
              >
                {submitting ? (
                  <>Submitting...</>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-1" />
                    Submit Answers
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[600px] rounded-2xl shadow-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            🧠 Conceptual Verification
          </DialogTitle>
          <DialogDescription>
            Answer questions about your code to verify understanding
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Progress */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">
                Question {currentIndex + 1} of {questions.length}
              </span>
              {timeLeft !== null && (
                <Badge variant={timeLeft < 30 ? "destructive" : "secondary"} className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTime(timeLeft)}
                </Badge>
              )}
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Question */}
          <div className="bg-muted/50 p-4 rounded-lg space-y-3">
            {currentQuestion.difficulty && (
              <Badge variant="outline">
                {currentQuestion.difficulty}
              </Badge>
            )}
            <p className="font-medium text-foreground leading-relaxed">
              {currentQuestion.prompt}
            </p>
            {currentQuestion.context_references && currentQuestion.context_references.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium">Context:</p>
                <ul className="list-disc list-inside">
                  {currentQuestion.context_references.map((ref, idx) => (
                    <li key={idx}>{ref}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Answer Textarea */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Your Answer</label>
              <span className={`text-xs ${currentAnswer.length >= 100 ? 'text-green-600' : 'text-muted-foreground'}`}>
                {currentAnswer.length} / 100 chars minimum
              </span>
            </div>
            <Textarea
              value={currentAnswer}
              onChange={(e) => handleAnswerChange(e.target.value)}
              placeholder="Provide a detailed answer explaining your understanding..."
              className="min-h-[150px] resize-none"
            />
          </div>

          {/* Navigation */}
          <div className="flex justify-between items-center pt-2">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              onClick={handleNext}
              disabled={currentAnswer.trim().length < 100}
            >
              {currentIndex === questions.length - 1 ? (
                <>
                  Review & Submit
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ConceptualQuestionsModal;
