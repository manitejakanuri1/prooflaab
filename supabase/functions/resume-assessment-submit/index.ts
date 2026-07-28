import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnswerInput {
  question_id: string;
  answer_text: string;
  selected_index?: number;
}

interface AnswerScore {
  question_id: string;
  correctness_score: number;
  explanation: string;
  final_score: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claims?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const callerId = claims.claims.sub;

    const { assessment_id, answers } = await req.json();
    if (!assessment_id || !Array.isArray(answers) || answers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'assessment_id and a non-empty answers array are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('user_id', callerId)
      .maybeSingle();
    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'Student profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: assessment, error: assessmentError } = await supabase
      .from('resume_assessments')
      .select('id, student_id, resume_claims_id, questions, status')
      .eq('id', assessment_id)
      .maybeSingle();

    if (assessmentError || !assessment) {
      return new Response(
        JSON.stringify({ error: 'Assessment not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (assessment.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (assessment.status !== 'pending') {
      return new Response(
        JSON.stringify({ error: `Cannot submit. Current status: ${assessment.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const questions = (assessment.questions ?? []) as any[];
    const questionsById = new Map(questions.map((q: any) => [q.id, q]));
    const timestampedAnswers = (answers as AnswerInput[]).map((a) => ({
      question_id: a.question_id,
      answer_text: a.answer_text ?? '',
      ...(typeof a.selected_index === 'number' ? { selected_index: a.selected_index } : {}),
      answered_at: new Date().toISOString(),
    }));

    const answerScores: AnswerScore[] = [];

    for (const answer of timestampedAnswers) {
      const question = questionsById.get(answer.question_id);
      if (!question) continue;

      if (question.type === 'mcq') {
        const correct = typeof answer.selected_index === 'number' && answer.selected_index === question.correct_index;
        answerScores.push({
          question_id: answer.question_id,
          correctness_score: correct ? 100 : 0,
          explanation: correct ? 'Correct answer selected' : 'Wrong or no option selected',
          final_score: correct ? 100 : 0,
        });
        continue;
      }

      // short_answer — grade with Gemini
      const evalPrompt = `You are checking whether a student's typed explanation shows real understanding, for a resume-verification test.

Question: ${question.prompt}
Student's answer: ${answer.answer_text || '(no answer given)'}

Return a JSON object:
{
  "correctness_score": <0-100, does this show real understanding of what they claimed>,
  "explanation": "<one sentence on why this score>"
}

Guidelines: a vague, generic, or copy-pasted-sounding answer with no specifics scores low even if technically not wrong. A specific, concrete explanation referencing real details scores high.

Return ONLY the JSON object.`;

      let score = 0;
      let explanation = 'Could not be graded';
      try {
        let geminiResponse!: Response;
        for (let attempt = 0; attempt < 2; attempt++) {
          geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: evalPrompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
              })
            }
          );
          if (geminiResponse.ok || ![429, 503].includes(geminiResponse.status)) break;
          await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        }
        if (geminiResponse.ok) {
          const geminiData = await geminiResponse.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            score = Math.max(0, Math.min(100, Math.round(parsed.correctness_score) || 0));
            explanation = parsed.explanation || explanation;
          }
        }
      } catch (e) {
        console.error('Short-answer grading failed:', e);
      }

      answerScores.push({
        question_id: answer.question_id,
        correctness_score: score,
        explanation,
        final_score: score,
      });
    }

    const skillProofScore = answerScores.length > 0
      ? Math.round(answerScores.reduce((sum, s) => sum + s.final_score, 0) / answerScores.length)
      : 0;

    const { error: updateError } = await supabase
      .from('resume_assessments')
      .update({
        student_answers: timestampedAnswers,
        answer_scores: answerScores,
        status: 'graded',
      })
      .eq('id', assessment_id);

    if (updateError) {
      console.error('Error saving graded assessment:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save assessment results' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: resumeClaim } = await supabase
      .from('resume_claims')
      .select('resume_quality_score, ats_match_score, skills, target_role')
      .eq('id', assessment.resume_claims_id)
      .maybeSingle();

    // Build a short, targeted roadmap from whichever questions scored low
    const weakQuestions = questions.filter((q: any) =>
      answerScores.some((s) => s.question_id === q.id && s.final_score < 70)
    );

    let roadmap = 'Solid performance across the board — keep your skills sharp with periodic re-checks.';
    if (weakQuestions.length > 0) {
      const roadmapPrompt = `A student targeting "${resumeClaim?.target_role || 'a role'}" with claimed skills [${(resumeClaim?.skills || []).join(', ')}] got these specific questions wrong or weak:

${weakQuestions.map((q: any, i: number) => `${i + 1}. ${q.prompt}`).join('\n')}

Write a short, specific, non-generic improvement roadmap (3-5 lines max). Name the exact weak topics implied by these questions and what to practice next. Do not say "learn everything from scratch." Plain English, encouraging tone.`;

      try {
        const roadmapResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: roadmapPrompt }] }],
              generationConfig: { temperature: 0.5, maxOutputTokens: 400 }
            })
          }
        );
        if (roadmapResponse.ok) {
          const roadmapData = await roadmapResponse.json();
          const text = roadmapData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) roadmap = text;
        }
      } catch (e) {
        console.error('Roadmap generation failed:', e);
      }
    }

    const { data: scorecard, error: scorecardError } = await supabase
      .from('resume_scorecards')
      .insert({
        student_id: profile.id,
        resume_claims_id: assessment.resume_claims_id,
        assessment_id: assessment.id,
        resume_quality_score: resumeClaim?.resume_quality_score ?? null,
        ats_match_score: resumeClaim?.ats_match_score ?? null,
        skill_proof_score: skillProofScore,
        roadmap,
      })
      .select('id')
      .single();

    if (scorecardError) {
      console.error('Error saving scorecard:', scorecardError);
      return new Response(
        JSON.stringify({ error: 'Failed to save scorecard' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Assessment graded, scorecard saved:', scorecard.id);

    return new Response(
      JSON.stringify({
        success: true,
        assessment_id: assessment.id,
        scorecard_id: scorecard.id,
        answer_scores: answerScores,
        skill_proof_score: skillProofScore,
        resume_quality_score: resumeClaim?.resume_quality_score ?? null,
        ats_match_score: resumeClaim?.ats_match_score ?? null,
        roadmap,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-assessment-submit:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
