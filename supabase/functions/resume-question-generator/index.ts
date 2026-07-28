import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

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

    const prompt = `You are building a short assessment to check whether a student really understands what they claim on their resume — not a generic quiz, ONLY based on the exact items below.

Target role: ${targetRole}
Skills claimed: ${skills.join(', ') || 'none listed'}
Certifications claimed: ${certifications.join(', ') || 'none listed'}
Projects claimed:
${projects.map((p, i) => `${i + 1}. ${p.name} — ${p.description} (tech: ${(p.tech_stack || []).join(', ')})`).join('\n') || 'none listed'}

Generate exactly 8 multiple-choice questions and exactly 2 short-answer questions (10 total). Each question will be shown one at a time with a 15-second timer, so keep every question short enough to read and answer that fast.

Rules for ALL questions:
- Base every question ONLY on the skills/certifications/projects listed above — never invent a skill or ask about something not claimed.
- One short, plain-English sentence (under 25 words) per question.
- Test real understanding, not trivia — the kind of thing only someone who actually used the skill or built the project would know.

MCQ rules:
- Mix skill-based, certification-based, project-based, and role-based questions.
- If a claimed skill is a programming language or framework, at least 2-3 of the MCQs should be code-reading style: show a short (1-3 line) code snippet using that language/framework in the prompt text and ask what it does or what's wrong with it.
- Exactly 4 options, exactly one correct answer, wrong options plausible.
- Vary difficulty (mix of easy and medium).

Short-answer rules:
- Both must be project-defense questions about a SPECIFIC claimed project (why that tech stack, what was their exact contribution, or what challenge they solved) — pick the 2 most detail-rich projects listed. If fewer than 2 projects are listed, ask general but specific skill-explanation questions instead ("explain how you would use X in a real scenario").
- These are graded by reading the student's typed explanation, so the question must require a real explanation, not a one-word answer.

Return a JSON array with this exact structure:
[
  {
    "id": "q1",
    "type": "mcq",
    "prompt": "Question text",
    "options": ["A", "B", "C", "D"],
    "correct_index": 0,
    "difficulty": "easy|medium"
  },
  {
    "id": "q9",
    "type": "short_answer",
    "prompt": "Question text"
  }
]

Return ONLY the JSON array, no additional text.`;

    console.log('Calling Gemini API for resume-based question generation...');

    let geminiResponse!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 5000 }
          })
        }
      );
      if (geminiResponse.ok || ![429, 503].includes(geminiResponse.status)) break;
      console.log(`Gemini ${geminiResponse.status}, retry ${attempt + 1}...`);
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
    }

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      if (geminiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ error: 'Failed to generate assessment' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = await geminiResponse.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Gemini response:', generatedText);

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
