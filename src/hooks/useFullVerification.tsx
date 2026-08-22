import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface FullVerificationParams {
  proofId: string;
  repoUrl?: string;
}

export const useFullVerification = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ proofId, repoUrl }: FullVerificationParams) => {
      const results: any = {};
      
      // Step 1: GitHub Check
      toast({
        title: "Starting Verification",
        description: "Step 1/5: Analyzing GitHub commits...",
      });

      try {
        const { data: githubData, error: githubError } = await supabase.functions.invoke('github-check', {
          body: { proof_id: proofId, repo_url: repoUrl }
        });

        if (githubError) throw new Error(`GitHub check failed: ${githubError.message}`);
        results.github = githubData;

        // Step 2: AI Authorship Analysis
        toast({
          title: "Verification Progress",
          description: "Step 2/5: Analyzing AI authorship...",
        });

        const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-authorship', {
          body: { 
            proof_id: proofId, 
            code_snippets_or_repo_summary: githubData?.repo_summary || "Code analysis"
          }
        });

        if (aiError) throw new Error(`AI authorship check failed: ${aiError.message}`);
        results.ai = aiData;

        // Step 3: Generate Conceptual Questions
        toast({
          title: "Verification Progress",
          description: "Step 3/5: Generating conceptual questions...",
        });

        const { data: questionsData, error: questionsError } = await supabase.functions.invoke('question-generator', {
          body: { proof_id: proofId, repo_url: repoUrl, top_n: 3 }
        });

        if (questionsError) throw new Error(`Question generation failed: ${questionsError.message}`);
        results.questions = questionsData;

        // Step 4: Notify student to answer questions
        toast({
          title: "Questions Generated",
          description: "Student will be notified to answer conceptual questions.",
          duration: 5000
        });

        // Insert notification for student
        const { data: proofData } = await supabase
          .from('proof_uploads')
          .select('student_id')
          .eq('id', proofId)
          .single();

        if (proofData) {
          // notifications is keyed on the auth user id now, and a browser
          // cannot insert a row addressed to someone else. This admin-only
          // function resolves the student's account and writes it server-side.
          // The parameters are named with a single underscore, not p_. They
          // were p_ here, so this call failed every time and the student was
          // never told their questions were ready.
          const { error: notifyError } = await supabase.rpc('admin_notify_student', {
            _student_id: proofData.student_id,
            _type: 'verification',
            _title: 'Conceptual Questions Ready',
            _message: 'Please answer the conceptual questions for your proof submission to complete verification.',
            _link: '/student/uploads',
          });
          if (notifyError) {
            console.error('Could not notify the student:', notifyError);
          }
        }

        results.status = 'awaiting_student_answers';

        return results;

      } catch (error: any) {
        console.error('Full verification error:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['proof-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['proof-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['student-conceptual-tests'] });
      
      if (data.status === 'awaiting_student_answers') {
        toast({
          title: "Verification In Progress",
          description: "Student has been notified to answer conceptual questions. Verification will complete after student responds.",
          duration: 7000
        });
      } else {
        toast({
          title: "Verification Complete",
          description: "Full verification workflow completed successfully.",
        });
      }
    },
    onError: (error: any) => {
      console.error('Error running full verification:', error);
      toast({
        title: "Verification Failed",
        description: error.message || "Failed to run full verification. Please try again.",
        variant: "destructive",
      });
    },
  });
};

// Hook to evaluate conceptual answers after student submits
export const useEvaluateAnswers = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (proofId: string) => {
      // Step 4: Evaluate Student Answers
      toast({
        title: "Evaluating Answers",
        description: "Step 4/5: Scoring conceptual responses...",
      });

      const { data: evalData, error: evalError } = await supabase.functions.invoke('response-evaluator', {
        body: { proof_id: proofId }
      });

      if (evalError) throw new Error(`Answer evaluation failed: ${evalError.message}`);

      // Step 5: Compute Trust Score
      toast({
        title: "Final Step",
        description: "Step 5/5: Computing cognitive integrity score...",
      });

      const { data: trustData, error: trustError } = await supabase.functions.invoke('trust-compute', {
        body: { proof_id: proofId }
      });

      if (trustError) throw new Error(`Trust computation failed: ${trustError.message}`);

      return { evaluation: evalData, trust: trustData };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['proof-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['proof-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['trust-scores'] });
      queryClient.invalidateQueries({ queryKey: ['student-conceptual-tests'] });
      
      toast({
        title: "Verification Complete",
        description: `Cognitive Integrity Score: ${data.trust?.cognitive_integrity_score || data.evaluation?.conceptual_understanding_score}/100`,
        duration: 7000
      });
    },
    onError: (error: any) => {
      toast({
        title: "Evaluation Failed",
        description: error.message || "Failed to evaluate answers and compute trust score.",
        variant: "destructive",
      });
    },
  });
};
