import { serve } from "../_shared/serve.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { generateText } from "../_shared/llm.ts";
import { cors } from "../_shared/cors.ts";
import { mayActOnStudentWork, forbidden } from "../_shared/authz.ts";

interface QuestionData {
  id: string;
  prompt: string;
  context_references?: string[];
  difficulty?: string;
}

interface StudentAnswer {
  question_id: string;
  answer_text: string;
  answered_at: string;
}

interface AnswerScore {
  question_id: string;
  correctness_score: number;
  ai_likelihood_score: number;
  confidence: number;
  explanation: string;
  repo_context_bonus: number;
  final_score: number;
}

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // Provider keys are resolved inside the shared helper (DeepSeek -> Gemini -> Kimi).

    // Check for webhook secret (for internal/scheduled calls)
    const webhookSecret = req.headers.get('x-webhook-secret');
    const expectedSecret = Deno.env.get('WEBHOOK_SECRET');
    
    // Check for JWT auth (for authenticated user calls)
    const authHeader = req.headers.get('Authorization');
    
    let isAuthorized = false;
    // Stays null on the webhook path: the scheduled caller is not a user and
    // has no proof of its own to be scoped against.
    let callerId: string | null = null;
    
    // Option 1: Webhook secret for internal/cron calls
    if (webhookSecret && expectedSecret && webhookSecret === expectedSecret) {
      isAuthorized = true;
    }
    // Option 2: JWT authentication for user calls
    else if (authHeader?.startsWith('Bearer ')) {
      const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      
      const token = authHeader.replace('Bearer ', '');
      const { data, error } = await supabaseClient.auth.getUser(token);
      
      if (!error && data?.user) {
        isAuthorized = true;
        callerId = data.user.id;
      }
    }
    
    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { proof_id } = await req.json();

    if (!proof_id) {
      return new Response(
        JSON.stringify({ error: 'Missing proof_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // A signed-in caller may only touch a proof they own, or one belonging to a
    // student in a college they administer. Being signed in was already checked;
    // being entitled to THIS proof was not. The webhook caller skips this.
    if (callerId) {
      const { data: ownerRow } = await supabase
        .from('proof_uploads')
        .select('student_profiles(user_id, college_id)')
        .eq('id', proof_id)
        .maybeSingle();

      const owner = (ownerRow as any)?.student_profiles;
      const mayAct = await mayActOnStudentWork(supabase, callerId, {
        ownerUserId: owner?.user_id ?? null,
        collegeId: owner?.college_id ?? null,
      });
      if (!mayAct) return forbidden(corsHeaders);
    }

    // Fetch conceptual test
    const { data: conceptualTest, error: fetchError } = await supabase
      .from('conceptual_tests')
      .select('*')
      .eq('proof_id', proof_id)
      .single();

    if (fetchError || !conceptualTest) {
      return new Response(
        JSON.stringify({ error: 'Conceptual test not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Allow evaluation for both 'submitted' (first time) and 'graded' (re-run)
    if (conceptualTest.status !== 'submitted' && conceptualTest.status !== 'graded') {
      return new Response(
        JSON.stringify({ error: `Cannot evaluate. Current status: ${conceptualTest.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const questions = conceptualTest.questions as QuestionData[];
    const studentAnswers = conceptualTest.student_answers as StudentAnswer[];

    if (!studentAnswers || studentAnswers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No student answers found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Evaluating ${studentAnswers.length} answers for proof ${proof_id}`);

    // Evaluate each answer
    const answerScores: AnswerScore[] = [];
    
    for (const answer of studentAnswers) {
      const question = questions.find(q => q.id === answer.question_id);
      if (!question) {
        console.warn(`Question ${answer.question_id} not found`);
        continue;
      }

      const evaluationPrompt = `You are an expert code reviewer evaluating a student's answer to a conceptual question about their code.

Question: ${question.prompt}
Context: ${question.context_references ? question.context_references.join(', ') : 'General code understanding'}

Student's Answer: ${answer.answer_text}

Please evaluate this answer and return a JSON object with the following structure:
{
  "correctness_score": <0-100, how well does this answer demonstrate understanding>,
  "confidence": <0-100, your confidence in this assessment>,
  "explanation": "<brief explanation of the score>",
  "ai_likelihood_score": <0-100, likelihood this was AI-generated (100=definitely AI, 0=definitely human)>,
  "repo_context_tokens": [<array of specific variable names, function names, or line references mentioned>]
}

Scoring guidelines:
- High correctness: Shows deep understanding, mentions specific implementation details
- Medium correctness: Shows general understanding but lacks specifics
- Low correctness: Vague, incorrect, or off-topic
- AI likelihood indicators: Generic language, overly formal, lacks specificity, no personal insights
- Human indicators: Specific references to their code, casual language, personal observations, typos`;

      try {
        // Provider selection and retry/backoff live in the shared helper.
        const { text: responseText } = await generateText(evaluationPrompt, {
          temperature: 0.3,
          maxOutputTokens: 1000,
        }, { feature: 'response-evaluator' });

        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error('No JSON found in model response:', responseText);
          throw new Error('Invalid model response format');
        }

        const evaluation = JSON.parse(jsonMatch[0]);

        // Calculate repo context bonus
        let repoContextBonus = 0;
        if (evaluation.repo_context_tokens && evaluation.repo_context_tokens.length > 0) {
          // Award 5 points per context token, up to 20 points max
          repoContextBonus = Math.min(evaluation.repo_context_tokens.length * 5, 20);
        }

        // Calculate final score
        // Weight: 70% correctness, 10% repo context, -20% if AI likelihood is high
        const aiPenalty = evaluation.ai_likelihood_score > 70 ? 20 : 0;
        const finalScore = Math.max(0, Math.min(100, 
          (evaluation.correctness_score * 0.7) + repoContextBonus - aiPenalty
        ));

        answerScores.push({
          question_id: answer.question_id,
          correctness_score: evaluation.correctness_score,
          ai_likelihood_score: evaluation.ai_likelihood_score,
          confidence: evaluation.confidence,
          explanation: evaluation.explanation,
          repo_context_bonus: repoContextBonus,
          final_score: Math.round(finalScore)
        });

        console.log(`Evaluated answer for question ${answer.question_id}: ${finalScore.toFixed(1)}`);

      } catch (error) {
        console.error(`Error evaluating answer ${answer.question_id}:`, error);
        // Add a default score if evaluation fails
        answerScores.push({
          question_id: answer.question_id,
          correctness_score: 0,
          ai_likelihood_score: 0,
          confidence: 0,
          explanation: `Evaluation failed: ${error.message}`,
          repo_context_bonus: 0,
          final_score: 0
        });
      }
    }

    // Calculate overall conceptual understanding score
    const conceptualUnderstandingScore = answerScores.length > 0
      ? Math.round(answerScores.reduce((sum, score) => sum + score.final_score, 0) / answerScores.length)
      : 0;

    // Update conceptual test with scores and status
    const { error: updateError } = await supabase
      .from('conceptual_tests')
      .update({
        answer_scores: answerScores,
        status: 'graded'
      })
      .eq('proof_id', proof_id);

    if (updateError) {
      console.error('Error updating conceptual test:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save evaluation results' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get proof details and notify student
    const { data: proofData } = await supabase
      .from('proof_uploads')
      .select('student_id, task_id, tasks(title)')
      .eq('id', proof_id)
      .single();

    if (!proofData) {
      console.error('Proof data not found for proof_id:', proof_id);
      return new Response(
        JSON.stringify({ error: 'Proof data not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send notification to student. The notifications table is keyed on the
    // auth user id since the four notification tables were merged, so the
    // student profile id has to be resolved first.
    const { data: studentAccount } = await supabase
      .from('student_profiles')
      .select('user_id')
      .eq('id', proofData.student_id)
      .maybeSingle();

    if (studentAccount?.user_id) {
      await supabase
        .from('notifications')
        .insert({
          user_id: studentAccount.user_id,
          audience: 'student',
          type: 'verification',
          title: 'Conceptual Evaluation Complete ✅',
          message: `You scored ${conceptualUnderstandingScore}/100 on your conceptual test.`,
          link: `/student/uploads`
        });
    }

    // Log to audit_logs
    await supabase
      .from('audit_logs')
      .insert({
        user_id: proofData.student_id,
        action: 'conceptual_answers_evaluated',
        table_name: 'conceptual_tests',
        record_id: proof_id,
        new_values: {
          proof_id,
          student_id: proofData.student_id,
          conceptual_understanding_score: conceptualUnderstandingScore,
          answer_count: answerScores.length
        }
      });

    console.log(`Evaluation complete for proof ${proof_id}: ${conceptualUnderstandingScore}/100`);

    return new Response(
      JSON.stringify({
        success: true,
        proof_id,
        student_id: proofData.student_id,
        conceptual_understanding_score: conceptualUnderstandingScore,
        answer_scores: answerScores,
        status: 'graded'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in response-evaluator:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
