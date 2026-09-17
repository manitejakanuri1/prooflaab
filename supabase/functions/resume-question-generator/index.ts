import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { generateText } from "../_shared/llm.ts";
import { rateLimitResponse } from '../_shared/rate-limit.ts';
import { cors } from "../_shared/cors.ts";

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

    // Two ways in, one assessment. A student who uploaded a resume sends
    // resume_claims_id; a student who pressed Skip sends student_interest_id.
    // Exactly one, never both — the same rule the database enforces on the row
    // this ends up writing.
    const { resume_claims_id, student_interest_id } = await req.json();
    if (!resume_claims_id === !student_interest_id) {
      return new Response(
        JSON.stringify({ error: 'send exactly one of resume_claims_id or student_interest_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const fromResume = Boolean(resume_claims_id);

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

    // Both sources are flattened to the same shape so everything below this
    // point — the prompt, the shuffle, the upsert — stays one code path. An
    // interests row simply has no certifications and no projects, which the
    // prompt already handles with its "none listed" wording.
    let source: {
      student_id: string;
      ready: boolean;
      target_role: string | null;
      skills: string[];
      certifications: string[];
      projects: { name: string; description: string; tech_stack: string[] }[];
    } | null = null;

    if (fromResume) {
      const { data: row } = await supabase
        .from('resume_claims')
        .select('student_id, status, target_role, skills, certifications, projects')
        .eq('id', resume_claims_id)
        .maybeSingle();
      if (row) {
        source = {
          student_id: row.student_id,
          ready: row.status === 'confirmed',
          target_role: row.target_role,
          skills: row.skills || [],
          certifications: row.certifications || [],
          projects: row.projects || [],
        };
      }
    } else {
      const { data: row } = await supabase
        .from('student_interests')
        .select('student_id, confirmed_at, target_role, skills, interests')
        .eq('id', student_interest_id)
        .maybeSingle();
      if (row) {
        // Interests are what this student says they want to work in, so they
        // are the skills being tested. Nothing else is claimed, so there is
        // nothing else to ask about.
        source = {
          student_id: row.student_id,
          ready: Boolean(row.confirmed_at),
          target_role: row.target_role,
          skills: [...(row.skills || []), ...(row.interests || [])],
          certifications: [],
          projects: [],
        };
      }
    }

    if (!source) {
      return new Response(
        JSON.stringify({ error: fromResume ? 'Resume claim not found' : 'Interests not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (source.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!source.ready) {
      return new Response(
        JSON.stringify({
          error: fromResume
            ? 'Confirm your resume claims before starting the assessment'
            : 'Confirm your interests before starting the assessment',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (source.skills.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nothing to build questions from — no skills listed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const skills: string[] = source.skills;
    const certifications: string[] = source.certifications;
    const projects: { name: string; description: string; tech_stack: string[] }[] = source.projects;
    const targetRole = source.target_role || 'the role they are targeting';

    // Project defence used to put all five of its questions on the single
    // richest project, so a resume listing three projects and eight skills was
    // half-examined on one of them. Coverage is spread instead: up to three
    // projects get two questions each, and the MCQs are told to touch every
    // skill and certification rather than clustering.
    const MAX_DEFENDED_PROJECTS = 3;
    const QUESTIONS_PER_PROJECT = 2;

    const defendedProjects = [...projects]
      .sort((a, b) => (b.description || '').length - (a.description || '').length)
      .slice(0, MAX_DEFENDED_PROJECTS);

    const mcqCount = 5;
    // Section 10 asks for two written answers alongside the five
    // multiple-choice. Defending a project is the better version of that
    // question — it is about their own work — so projects count toward the two,
    // and short answers only top up whatever they do not cover. A student with
    // exactly one project used to get one written question in total.
    const WRITTEN_MINIMUM = 2;
    const fallbackShortAnswerCount = Math.max(0, WRITTEN_MINIMUM - defendedProjects.length);

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
- SPREAD THE COVERAGE. Do not ask two questions about the same skill, certification or project. Work across the whole list above so as much of the resume as possible is examined, rather than going deep on one item.
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
    "topic": "Short subject heading, e.g. 'React - State' or 'SQL - Joins'",
    "prompt": "Question text",
    "options": ["A", "B", "C", "D"],
    "correct_index": 0,
    "explanation": "A funny, quirky one-liner on why this option is correct",
    "difficulty": "easy|medium"
  }${fallbackShortAnswerCount > 0 ? `,
  {
    "id": "q6",
    "type": "short_answer",
    "topic": "Short subject heading",
    "prompt": "Question text"
  }` : ''}
]

Every question needs a "topic": a short subject heading (under 6 words) naming the technology and the specific concept being tested, so the student can see what area they are being asked about before they read the question.

Return ONLY the JSON array, no additional text.`;

    console.log('Calling LLM for resume-based question generation...');

    // The model occasionally returns malformed JSON (a trailing comma before a
    // closing bracket was the one seen live, 1 call in 29), which used to fail
    // the student's whole test. Strip trailing commas, and ask once more if the
    // reply still does not parse.
    let questions: any[] | null = null;
    for (let attempt = 1; attempt <= 2 && !questions; attempt++) {
      let generatedText: string;
      try {
        const result = await generateText(prompt, { temperature: 0.6, maxOutputTokens: 5000 }, { feature: 'resume-question-generator', userId: callerId, studentId: profile.id });
        generatedText = result.text;
        console.log(`LLM (${result.provider}) response:`, generatedText);
      } catch (e) {
        console.error('LLM call failed:', e);
        // Over-budget callers get a 429 with Retry-After, not a generic failure,
        // so the client can tell 'wait' apart from 'broken'.
        const limited = rateLimitResponse(e, corsHeaders);
        if (limited) return limited;
        return new Response(
          JSON.stringify({ error: 'Failed to generate assessment' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      try {
        const jsonMatch = generatedText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array found in response');
        questions = JSON.parse(jsonMatch[0].replace(/,\s*([}\]])/g, '$1'));
      } catch (parseError) {
        console.error(`Failed to parse LLM response (attempt ${attempt}):`, parseError);
      }
    }

    if (!questions) {
      return new Response(
        JSON.stringify({ error: 'Failed to parse generated assessment' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Two fixed questions per project, across up to three projects. Fixed
    // wording rather than LLM-written so coverage never drifts, and rotated so
    // a student is not asked the same two things about every project.
    const DEFENCE_QUESTIONS = [
      (p: { name: string }) => `What problem did your "${p.name}" project solve?`,
      (p: { name: string; tech_stack?: string[] }) =>
        `Why did you choose ${(p.tech_stack || []).join(', ') || 'that tech stack'} for "${p.name}"?`,
      (p: { name: string }) => `What exactly was your own contribution to "${p.name}"?`,
      (p: { name: string }) =>
        `What was the toughest challenge you hit building "${p.name}", and how did you solve it?`,
    ];

    let defenceId = mcqCount;
    defendedProjects.forEach((p, projectIndex) => {
      for (let i = 0; i < QUESTIONS_PER_PROJECT; i++) {
        const ask = DEFENCE_QUESTIONS[(projectIndex * QUESTIONS_PER_PROJECT + i) % DEFENCE_QUESTIONS.length];
        defenceId += 1;
        questions.push({
          id: `q${defenceId}`,
          type: 'short_answer',
          prompt: ask(p),
          category: 'project_defense',
        });
      }
    });

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
          resume_claims_id: fromResume ? resume_claims_id : null,
          student_interest_id: fromResume ? null : student_interest_id,
          student_id: profile.id,
          questions,
          student_answers: [],
          answer_scores: null,
          status: 'pending',
          is_retest: false,
          // Stamped here rather than taken from created_at: this row is upserted
          // on the source id, so created_at still holds the first attempt.
          started_at: new Date().toISOString(),
          elapsed_seconds: null,
        },
        { onConflict: fromResume ? 'resume_claims_id' : 'student_interest_id' }
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

    // The browser is sent the question without its answer.
    //
    // correct_index used to ride along in this payload, so anyone could open the
    // network tab and read the right option before choosing one. On a platform
    // whose claim is that a build-log beats a certificate, a score you can look
    // up is a certificate. Grading reads correct_index from the row saved above,
    // never from what the client sends back, so nothing needs it here.
    const publicQuestions = questions.map(({ correct_index: _omit, explanation: _also, ...rest }: any) => rest);

    return new Response(
      JSON.stringify({ success: true, assessment_id: assessment.id, questions: publicQuestions }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-question-generator:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
