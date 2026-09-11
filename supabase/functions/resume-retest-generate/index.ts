import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";
import { rateLimitResponse } from '../_shared/rate-limit.ts';
import { cors } from "../_shared/cors.ts";

// Force a study gap before a retest unlocks — the point is to work through the
// roadmap first, not immediately re-answer the same weak topics.
const COOLDOWN_DAYS = 3;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

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

    const { resume_claims_id } = await req.json();
    if (!resume_claims_id) {
      return new Response(
        JSON.stringify({ error: 'resume_claims_id is required' }),
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

    const { data: resumeClaim, error: claimFetchError } = await supabase
      .from('resume_claims')
      .select('id, student_id, status, target_role')
      .eq('id', resume_claims_id)
      .maybeSingle();

    if (claimFetchError || !resumeClaim) {
      return new Response(
        JSON.stringify({ error: 'Resume claim not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (resumeClaim.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: assessment, error: assessmentError } = await supabase
      .from('resume_assessments')
      .select('id, status, questions, answer_scores, updated_at')
      .eq('resume_claims_id', resume_claims_id)
      .maybeSingle();

    if (assessmentError || !assessment) {
      return new Response(
        JSON.stringify({ error: 'No assessment found — complete an assessment before retesting weak topics.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (assessment.status !== 'graded') {
      return new Response(
        JSON.stringify({ error: 'Finish grading the current assessment before retesting weak topics.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const gradedAt = new Date(assessment.updated_at).getTime();
    const msSinceGraded = Date.now() - gradedAt;
    if (msSinceGraded < COOLDOWN_MS) {
      const availableAt = new Date(gradedAt + COOLDOWN_MS).toISOString();
      const daysRemaining = Math.ceil((COOLDOWN_MS - msSinceGraded) / (24 * 60 * 60 * 1000));
      return new Response(
        JSON.stringify({
          error: `Work through your roadmap first — retest unlocks in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
          cooldown_active: true,
          available_at: availableAt,
          days_remaining: daysRemaining,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const answerScores = (assessment.answer_scores ?? []) as any[];
    const weakScores = answerScores.filter((s) => s.final_score < 70);

    if (weakScores.length === 0) {
      return new Response(
        JSON.stringify({ success: true, no_weak_topics: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetRole = resumeClaim.target_role || 'the role they are targeting';
    const questionCount = Math.min(weakScores.length, 6);
    const retestTopics = weakScores.slice(0, questionCount);

    const prompt = `You are building a short retest for a student targeting "${targetRole}". They previously scored weak on the questions below — write ONE fresh question per item testing the SAME underlying concept, but not a rephrasing of the same question (so they can't just recall the earlier answer).

Weak questions from their last attempt:
${retestTopics.map((s: any, i: number) => `${i + 1}. [${s.question_type}] "${s.question_prompt}" — they answered "${s.student_answer}" (scored ${s.final_score}/100: ${s.explanation})`).join('\n')}

Rules:
- Generate exactly ${questionCount} questions, one per item above, in the same order.
- Keep the same question type as the item it replaces (mcq stays mcq, short_answer stays short_answer).
- One short, plain-English sentence (under 25 words) per question.
- For mcq: exactly 4 options, exactly one correct answer, wrong options plausible, vary difficulty. If the topic is a programming language or framework, prefer a short (1-3 line) code-reading snippet in the prompt.
- For short_answer: require a real typed explanation (not one word) about the same project/skill/concept as the original question.
- Every mcq needs an "explanation" field: why the correct option is correct, written with real personality — a quirky, funny one-liner (witty friend, not a textbook footnote), under 25 words, that still nails the technical reason.

Return a JSON array with this exact structure:
[
  {
    "id": "r1",
    "type": "mcq",
    "prompt": "Question text",
    "options": ["A", "B", "C", "D"],
    "correct_index": 0,
    "explanation": "A funny, quirky one-liner on why this option is correct",
    "difficulty": "easy|medium"
  },
  {
    "id": "r2",
    "type": "short_answer",
    "prompt": "Question text"
  }
]

Return ONLY the JSON array, no additional text.`;

    console.log('Calling LLM for weak-topic retest generation...');

    let generatedText: string;
    try {
      const result = await generateText(prompt, { temperature: 0.6, maxOutputTokens: 3000 }, { feature: 'resume-retest-generate' });
      generatedText = result.text;
      console.log(`LLM (${result.provider}) response:`, generatedText);
    } catch (e) {
      console.error('LLM call failed:', e);
      // Over-budget callers get a 429 with Retry-After, not a generic failure,
      // so the client can tell 'wait' apart from 'broken'.
      const limited = rateLimitResponse(e, corsHeaders);
      if (limited) return limited;
      return new Response(
        JSON.stringify({ error: 'Failed to generate retest' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let questions: any[];
    try {
      const jsonMatch = generatedText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      questions = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse retest response:', parseError);
      return new Response(
        JSON.stringify({ error: 'Failed to parse generated retest' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Shuffle MCQ option order — LLMs put the correct answer first far too often
    for (const q of questions) {
      if (q.type === 'mcq' && Array.isArray(q.options) && typeof q.correct_index === 'number') {
        const correctText = q.options[q.correct_index];
        for (let i = q.options.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
        }
        q.correct_index = q.options.indexOf(correctText);
      }
    }

    const { data: newAssessment, error: upsertError } = await supabase
      .from('resume_assessments')
      .upsert(
        {
          resume_claims_id,
          student_id: profile.id,
          questions,
          student_answers: [],
          answer_scores: null,
          status: 'pending',
          is_retest: true,
          // Fresh clock per attempt; the row is upserted, so created_at still
          // points at the first one.
          started_at: new Date().toISOString(),
          elapsed_seconds: null,
        },
        { onConflict: 'resume_claims_id' }
      )
      .select('id')
      .single();

    if (upsertError || !newAssessment) {
      console.error('Error saving retest assessment:', upsertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save retest' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Successfully generated weak-topic retest:', newAssessment.id);

    return new Response(
      // Answers stripped for the same reason as the first-attempt generator:
      // grading reads correct_index from the saved row, so sending it to the
      // browser only ever let someone read the answer before choosing.
      JSON.stringify({
        success: true,
        assessment_id: newAssessment.id,
        questions: questions.map(({ correct_index: _omit, explanation: _also, ...rest }: any) => rest),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-retest-generate:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
