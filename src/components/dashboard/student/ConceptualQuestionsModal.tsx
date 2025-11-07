import { useState, useEffect } from "react";
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
import { ChevronLeft, ChevronRight, Clock, Send, Brain } from "lucide-react";

interface Question {
  id: string;
  prompt: string;
  context_references?: string[];
  difficulty?: string;
  time_limit_seconds?: number;
}

interface ConceptualQuestionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proofId: string;
  onSubmitSuccess?: () => void;
}

const ConceptualQuestionsModal = ({ 
  open, 
  onOpenChange, 
  proofId,
  onSubmitSuccess 
}: ConceptualQuestionsModalProps) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const { toast } = useToast();

  // Fetch questions when modal opens
  useEffect(() => {
    if (open && proofId) {
      fetchQuestions();
    }
  }, [open, proofId]);

  // Timer countdown
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  // Start timer when question changes
  useEffect(() => {
    if (questions.length > 0 && currentIndex < questions.length) {
      const currentQuestion = questions[currentIndex];
      if (currentQuestion.time_limit_seconds) {
        setTimeLeft(currentQuestion.time_limit_seconds);
      } else {
        setTimeLeft(120); // Default 2 minutes
      }
    }
  }, [currentIndex, questions]);

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('conceptual_tests')
        .select('questions')
        .eq('proof_id', proofId)
        .single();

      if (error) throw error;

      if (data?.questions && Array.isArray(data.questions)) {
        setQuestions(data.questions as unknown as Question[]);
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
      // Prepare answers array
      const answersArray = questions.map(q => ({
        question_id: q.id,
        answer_text: answers[q.id] || ""
      }));

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