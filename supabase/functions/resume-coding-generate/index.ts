import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { rateLimitResponse } from '../_shared/rate-limit.ts';
import { cors } from "../_shared/cors.ts";
import { tryGenerateSandbox } from "../_shared/auto-config.ts";
import { sandboxConfigRow } from "../_shared/function-generation.ts";

// Skills claimed on a resume, mapped to a language the ProofLab code runner can
// execute. First match wins. TypeScript is deliberately absent: the runner has no
// TypeScript runtime, so a TypeScript student failed every test (N22).
const LANGUAGE_MAP: Record<string, string> = {
  python: 'python', java: 'java', javascript: 'javascript',
  'c++': 'cpp', cpp: 'cpp', c: 'c', go: 'go', golang: 'go', ruby: 'ruby', php: 'php',
};

function pickLanguage(skills: string[]): string {
  for (const skill of skills) {
    const key = skill.toLowerCase().trim();
    if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
  }
  return 'python';
}

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

    // Same two ways in as the quiz: a resume, or the interests a student picked
    // after pressing Skip. Exactly one.
    const { resume_claims_id, student_interest_id } = await req.json();
    if (!resume_claims_id === !student_interest_id) {
      return new Response(
        JSON.stringify({ error: 'send exactly one of resume_claims_id or student_interest_id' }),
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

    const fromResume = Boolean(resume_claims_id);

    const { data: resumeClaim } = fromResume
      ? await supabase
          .from('resume_claims')
          .select('id, student_id, skills, target_role, projects')
          .eq('id', resume_claims_id)
          .maybeSingle()
      : await supabase
          .from('student_interests')
          .select('id, student_id, skills, interests, target_role')
          .eq('id', student_interest_id)
          .maybeSingle()
          .then(({ data }) => ({
            data: data
              ? {
                  id: data.id,
                  student_id: data.student_id,
                  // Interests are the skills for this student — pickLanguage
                  // reads this list to choose the coding language.
                  skills: [...(data.skills || []), ...(data.interests || [])],
                  target_role: data.target_role,
                  projects: [],
                }
              : null,
          }));

    if (!resumeClaim || resumeClaim.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: fromResume ? 'Resume claim not found' : 'Interests not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: assessment } = await supabase
      .from('resume_assessments')
      .select('id, student_id')
      .eq(fromResume ? 'resume_claims_id' : 'student_interest_id', fromResume ? resume_claims_id : student_interest_id)
      .maybeSingle();

    if (!assessment || assessment.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Complete the quiz before the coding round' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const skills: string[] = resumeClaim.skills || [];
    const language = pickLanguage(skills);
    const targetRole = resumeClaim.target_role || 'a software role';

    // The shared coding engine writes each problem (auto-config.ts): the model
    // drafts the problem, a reference solution, normal/boundary/edge tests and a
    // deliberately buggy solution; ProofLab's runner then proves the reference
    // passes every test AND that obviously wrong programs fail (test-quality.ts).
    // Tests are stored in task_sandbox_config (admin-only, frozen once used), never
    // in anything a student can read. Before 3 Oct 2026 this round used 3
    // AI-written tests that were never executed against any solution.
    const problemSpec = (n: number) => ({
      kind: 'scenario' as const,
      promptBody: `Write coding problem ${n} of 2 for a student targeting "${targetRole}" who claims these skills: ${skills.join(', ') || 'general programming'}.

Rules:
- The language MUST be ${language}. The student implements ONE function (no reading input, no printing): you choose its name, parameters and return type in "function_spec".
- Easy: solvable in under 15 lines, in a few minutes. Problem ${n === 1 ? '1 is about basic data handling (strings or arrays)' : '2 uses a loop with a condition or a simple calculation'}, and relates to the claimed skills where possible.
- "statement" says, in simple English: what the function must return for its arguments, and one example call with its return value and a one-line explanation of why.`,
      fields: {
        title: 'string, max 60 chars',
        statement: 'string: task, Input, Output, Example and why',
      },
    });

    // Coding problems depend only on the skills and the target role, so two
    // students with the same profile share them. 'coding_round_v3' (function mode, 7 Oct 2026):
    // stdio rounds cached under v2, and the inline unvalidated v1 rounds, are never reused.
    const { data: keyRow } = await supabase.rpc('template_key', {
      _kind: 'coding_round_v3', _role: targetRole, _skills: skills, _extra: language,
    });
    const cacheKey = keyRow as unknown as string | null;

    let codingQuestions: any[] | null = null;
    if (cacheKey) {
      const { data: cached } = await supabase
        .from('ai_templates').select('payload').eq('template_key', cacheKey).maybeSingle();
      if (Array.isArray(cached?.payload) && cached.payload.every((q: any) => q?.sandbox_config_id)) {
        console.log('coding round served from template cache:', cacheKey);
        codingQuestions = cached.payload as any[];
        await supabase.rpc('touch_template', { _key: cacheKey });
      }
    }

    if (!codingQuestions) {
      let outcomes;
      try {
        // Function mode, Easy (4-5 tests): the same engine and quality gate as every other coding task.
        outcomes = await Promise.all([1, 2].map((n) =>
          tryGenerateSandbox(problemSpec(n), 'resume-coding-generate', { userId: callerId, studentId: profile.id },
            { kind: 'function', difficulty: 'Easy' })));
      } catch (e) {
        console.error('Coding round generation failed:', e);
        const limited = rateLimitResponse(e, corsHeaders);
        if (limited) return limited;
        return new Response(
          JSON.stringify({ error: 'Failed to generate coding problems' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const built: any[] = [];
      for (const [i, outcome] of outcomes.entries()) {
        const attempt = outcome.attempt;
        // A problem in another language, or one whose tests never validated, is not served.
        if (!outcome.ok || !attempt || attempt.language !== language) continue;
        const { data: cfg, error: cfgError } = await supabase.from('task_sandbox_config')
          .insert(sandboxConfigRow(attempt, null, 100, 'resume')).select('id').single();
        if (cfgError || !cfg) {
          console.error('Could not store a coding problem:', cfgError?.message);
          continue;
        }
        const fields = outcome.scenarioFields as Record<string, unknown>;
        built.push({
          id: `c${i + 1}`,
          language: attempt.language,
          prompt: String(fields.statement ?? fields.title ?? '').trim(),
          starter_code: attempt.starter_code,
          sandbox_config_id: cfg.id,
          // The signature is not secret; hidden tests never leave the config.
          kind: attempt.kind ?? 'stdio',
          ...(attempt.kind === 'function' ? { function_spec: attempt.function_spec } : {}),
          sample_test: (() => {
            const t = attempt.test_cases.find((x) => x.visible);
            return t ? { stdin: t.stdin, expected_output: t.expected_output } : null;
          })(),
        });
      }
      if (built.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Could not prepare coding problems right now. Please try again in a minute.' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      codingQuestions = built;
      // Cached only when both problems validated; a half round is served once, not shared.
      if (cacheKey && built.length === 2) {
        // ai_templates.kind only allows 'coding_round' (stage13 check constraint); the version lives
        // in the cache key. The old 'coding_round_v2' row value was refused, so rounds were never cached.
        const { error: cacheError } = await supabase.from('ai_templates').upsert({
          template_key: cacheKey, kind: 'coding_round', role: targetRole, paths: skills, payload: built,
        }, { onConflict: 'template_key' });
        if (cacheError) console.error('Coding round not cached:', cacheError.message);
      }
    }

    const { error: updateError } = await supabase
      .from('resume_assessments')
      .update({ coding_questions: codingQuestions })
      .eq('id', assessment.id);

    if (updateError) {
      console.error('Error saving coding questions:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save coding problems' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only the visible example is shown; every test stays server-side and is used
    // only by resume-code-execute.
    const publicQuestions = codingQuestions.map((q: any) => ({
      id: q.id,
      language: q.language,
      prompt: q.prompt,
      starter_code: q.starter_code,
      sample_test: q.sample_test
        ? { stdin: q.sample_test.stdin, expected_output: q.sample_test.expected_output }
        : null,
    }));

    return new Response(
      JSON.stringify({ success: true, assessment_id: assessment.id, questions: publicQuestions }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-coding-generate:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
