import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { proof_id } = await req.json();

    if (!proof_id) {
      return new Response(
        JSON.stringify({ error: 'Missing proof_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get auth user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    if (conceptualTest.status !== 'submitted') {
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
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: evaluationPrompt }]
              }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1000,
              }
            })
          }
        );

        if (!geminiResponse.ok) {
          const errorText = await geminiResponse.text();
          console.error('Gemini API error:', errorText);
          throw new Error(`Gemini API error: ${geminiResponse.status}`);
        }

        const geminiData = await geminiResponse.json();
        const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error('No JSON found in Gemini response:', responseText);
          throw new Error('Invalid Gemini response format');
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

    // Update conceptual test with scores
    const { error: updateError } = await supabase
      .from('conceptual_tests')
      .update({
        answer_scores: answerScores,
        status: 'completed'
      })
      .eq('proof_id', proof_id);

    if (updateError) {
      console.error('Error updating conceptual test:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save evaluation results' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log to audit_logs
    await supabase
      .from('audit_logs')
      .insert({
        user_id: user.id,
        action: 'conceptual_answers_evaluated',
        table_name: 'conceptual_tests',
        record_id: proof_id,
        new_values: {
          proof_id,
          conceptual_understanding_score: conceptualUnderstandingScore,
          answer_count: answerScores.length
        }
      });

    console.log(`Evaluation complete for proof ${proof_id}: ${conceptualUnderstandingScore}/100`);

    return new Response(
      JSON.stringify({
        success: true,
        proof_id,
        conceptual_understanding_score: conceptualUnderstandingScore,
        answer_scores: answerScores,
        status: 'completed'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in response-evaluator:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
