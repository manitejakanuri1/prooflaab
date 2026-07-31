import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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
      .select('id, student_id, status, target_role, skills, certifications, projects')
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
    if (resumeClaim.status !== 'confirmed') {
      return new Response(
        JSON.stringify({ error: 'Confirm your resume claims before starting the assessment' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const skills: string[] = resumeClaim.skills || [];
    const certifications: string[] = resumeClaim.certifications || [];
    const projects: { name: string; description: string; tech_stack: string[] }[] = resumeClaim.projects || [];
    const targetRole = resumeClaim.target_role || 'the role they are targeting';

    // Deepened project-defense: one real claimed project gets the 5 specific
    // sub-questions from the product doc instead of 2 generic ones, so the LLM
    // only needs to cover MCQs here.
    const richestProject = projects.length > 0
      ? [...projects].sort((a, b) => (b.description || '').length - (a.description || '').length)[0]
      : null;
    const mcqCount = 5;
    const fallbackShortAnswerCount = richestProject ? 0 : 2;

    const prompt = `You are building a short assessment to check whether a student really understands what they claim on their resume — not a generic quiz, ONLY based on the exact items below.

Target role: ${targetRole}
Skills claimed: ${skills.join(', ') || 'none listed'}
Certifications claimed: ${certifications.join(', ') || 'none listed'}
Projects claimed:
${projects.map((p, i) => `${i + 1}. ${p.name} — ${p.description} (tech: ${(p.tech_stack || []).join(', ')})`).join('\n') || 'none listed'}

Generate exactly ${mcqCount} multiple-choice questions${fallbackShortAnswerCount > 0 ? ` and exactly ${fallbackShortAnswerCount} short-answer questions` : ''}. Each question will be shown one at a time with a 15-second timer, so keep every question short enough to read and answer that fast.

Rules for ALL questions:
- Base every question ONLY on the skills/certifications/projects listed above — never invent a skill or ask about something not claimed.
- One short, plain-English sentence (under 25 words) per question.
- Test real understanding, not trivia — the kind of thing only someone who actually used the skill or built the project would know.

MCQ rules:
- Mix skill-based, certification-based, project-based, and role-based questions.
- If a claimed skill is a programming language or framework, at least 1-2 of the MCQs should be code-reading style: show a short (1-3 line) code snippet using that language/framework in the prompt text and ask what it does or what's wrong with it.
- Exactly 4 options, exactly one correct answer, wrong options plausible.
- Vary difficulty (mix of easy and medium).
${fallbackShortAnswerCount > 0 ? `
Short-answer rules:
- Ask general but specific skill-explanation questions ("explain how you would use X in a real scenario") — no project to defend here, so don't invent one.
- These are graded by reading the student's typed explanation, so the question must require a real explanation, not a one-word answer.
` : ''}
Every MCQ also needs an "explanation" field: why the correct option is correct, but write it with actual personality — a quirky, funny one-liner (think witty friend, not a textbook footnote), under 25 words, that still nails the technical reason.

Return a JSON array with this exact structure:
[
  {
    "id": "q1",
    "type": "mcq",
    "prompt": "Question text",
    "options": ["A", "B", "C", "D"],
    "correct_index": 0,
    "explanation": "A funny, quirky one-liner on why this option is correct",
    "difficulty": "easy|medium"
  }${fallbackShortAnswerCount > 0 ? `,
  {
    "id": "q6",
    "type": "short_answer",
    "prompt": "Question text"
  }` : ''}
]

Return ONLY the JSON array, no additional text.`;

    console.log('Calling LLM for resume-based question generation...');

    let generatedText: string;
    try {
      const result = await generateText(prompt, { temperature: 0.6, maxOutputTokens: 5000 });
      generatedText = result.text;
      console.log(`LLM (${result.provider}) response:`, generatedText);
    } catch (e) {
      console.error('LLM call failed:', e);
      return new Response(
        JSON.stringify({ error: 'Failed to generate assessment' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let questions: any[];
    try {
      const jsonMatch = generatedText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      questions = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError);
      return new Response(
        JSON.stringify({ error: 'Failed to parse generated assessment' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deepened project-defense: 5 fixed sub-questions on the richest claimed
    // project, worded verbatim per the product doc — no LLM involved so the
    // wording/coverage never drifts.
    if (richestProject) {
      const p = richestProject;
      const defenseQuestions = [
        `What problem did your "${p.name}" project solve?`,
        `Why did you choose ${(p.tech_stack || []).join(', ') || 'that tech stack'} for "${p.name}"?`,
        `What exactly was your own contribution to "${p.name}"?`,
        `What was the toughest challenge you hit building "${p.name}", and how did you solve it?`,
        `Why that particular database, API, framework, or model in "${p.name}"?`,
      ];
      defenseQuestions.forEach((prompt, i) => {
        questions.push({ id: `q${mcqCount + 1 + i}`, type: 'short_answer', prompt, category: 'project_defense' });
      });
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

    const { data: assessment, error: upsertError } = await supabase
      .from('resume_assessments')
      .upsert(
        {
          resume_claims_id,
          student_id: profile.id,
          questions,
          student_answers: [],
          answer_scores: null,
          status: 'pending',
          is_retest: false,
        },
        { onConflict: 'resume_claims_id' }
      )
      .select('id')
      .single();

    if (upsertError || !assessment) {
      console.error('Error saving resume assessment:', upsertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save assessment' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Successfully generated resume assessment:', assessment.id);

    return new Response(
      JSON.stringify({ success: true, assessment_id: assessment.id, questions }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-question-generator:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
