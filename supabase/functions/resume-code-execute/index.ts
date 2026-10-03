import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { guard } from '../_shared/rate-limit.ts';
import { cors } from "../_shared/cors.ts";
import { gradeTests, redact, type SandboxTest } from "../_shared/sandbox.ts";

// stage69: the runner (Wandbox -> Godbolt -> Glot chain) moved to
// _shared/sandbox.ts so run-sandbox and submit-sandbox-task use the exact
// same code instead of a second copy of this logic. Behaviour here is
// unchanged — this file is now just the resume-assessment-specific wiring
// around that shared runner.

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Runs submitted code against a third-party executor; worth capping on its own.
  const limited = await guard(req, {
    bucket: 'resume-code-execute',
    limit: 60,
    windowSeconds: 3600,
    corsHeaders,
  });
  if (limited) return limited;

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

    const { assessment_id, question_id, code, mode } = await req.json();
    if (!assessment_id || !question_id || typeof code !== 'string' || !['run', 'submit', 'skip'].includes(mode)) {
      return new Response(
        JSON.stringify({ error: 'assessment_id, question_id, code, and mode ("run"|"submit"|"skip") are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (code.length > 20000) {
      return new Response(
        JSON.stringify({ error: 'Code is too long' }),
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
      .select('id, student_id, resume_claims_id, coding_questions, coding_results')
      .eq('id', assessment_id)
      .maybeSingle();

    if (assessmentError || !assessment || assessment.student_id !== profile.id) {
      return new Response(
        JSON.stringify({ error: 'Assessment not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const codingQuestions = (assessment.coding_questions || []) as any[];
    const question = codingQuestions.find((q: any) => q.id === question_id);
    if (!question) {
      return new Response(
        JSON.stringify({ error: 'Coding question not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const existingResults = (assessment.coding_results || {}) as Record<string, any>;
    if (mode !== 'run' && existingResults[question_id]) {
      return new Response(
        JSON.stringify({ error: 'This question has already been submitted' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // skip: the student moves on without running anything. It scores 0 for
    // this question - every test counted as failed - and is recorded like a
    // submission, so the round can finish. Before this a student whose code
    // could not run (or who simply wanted to move on) had to sit out the timer:
    // "Submit & next" stays disabled until code has run once.
    // The shared coding engine (sandbox.ts) grades this round exactly like a Daily
    // Lot. New rounds keep their tests in task_sandbox_config (admin-only, frozen
    // once used - migration 52); a round generated before 3 Oct 2026 still carries
    // its tests inline, where test 1 was the visible sample.
    let tests: SandboxTest[];
    let language: string = question.language;
    if (question.sandbox_config_id) {
      const { data: cfg } = await supabase
        .from('task_sandbox_config').select('language, test_cases').eq('id', question.sandbox_config_id).maybeSingle();
      if (!cfg) {
        return new Response(
          JSON.stringify({ error: 'This coding question is no longer available' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      tests = cfg.test_cases as SandboxTest[];
      language = cfg.language;
    } else {
      tests = (question.test_cases || []).map((t: any, i: number) => ({
        id: `t${i + 1}`, stdin: String(t.stdin ?? ''), expected_output: String(t.expected_output ?? ''), visible: i === 0,
      }));
    }

    // Run: only the examples the student can see. Submit: every test. Skip: none.
    const toRun = mode === 'run' ? tests.filter((t) => t.visible) : mode === 'skip' ? [] : tests;
    let results: any[] = [];
    if (toRun.length) {
      const graded = await gradeTests(language, code, toRun);
      // The runner never started. Stop here rather than recording a failure the
      // student did not earn.
      if (!graded.ok) {
        return new Response(
          JSON.stringify({
            error: 'The code runner is busy right now. This is not a problem with your code - please try again in a moment.',
            runner_unavailable: true,
          }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      results = graded.results;
    }

    if (mode === 'run') {
      return new Response(
        JSON.stringify({ success: true, results }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // submit mode: persist this question's result, and if all coding questions
    // are now submitted, compute the final coding score onto the scorecard.
    const passCount = results.filter((r) => r.passed).length;
    // Always the full set: a compile error that stops early still fails every test.
    const total: number = tests.length;
    const updatedResults: Record<string, any> = {
      ...existingResults,
      [question_id]: { pass_count: passCount, total, results, ...(mode === 'skip' ? { skipped: true } : {}) },
    };

    const { error: updateError } = await supabase
      .from('resume_assessments')
      .update({ coding_results: updatedResults })
      .eq('id', assessment_id);

    if (updateError) {
      console.error('Error saving coding result:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save result' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const allSubmitted = codingQuestions.every((q: any) => updatedResults[q.id]);
    let codingScore: number | null = null;

    if (allSubmitted) {
      const totalPass = codingQuestions.reduce((sum: number, q: any) => sum + (updatedResults[q.id]?.pass_count || 0), 0);
      const totalCases = codingQuestions.reduce((sum: number, q: any) => sum + (updatedResults[q.id]?.total || 0), 0);
      codingScore = totalCases > 0 ? Math.round((totalPass / totalCases) * 100) : 0;

      const { error: scorecardError } = await supabase
        .from('resume_scorecards')
        .update({ coding_score: codingScore })
        .eq('assessment_id', assessment_id);
      if (scorecardError) {
        console.error('Error updating scorecard with coding score:', scorecardError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        pass_count: passCount,
        total,
        // N21: hidden tests never leave the server - only whether each passed.
        results: redact(results),
        all_submitted: allSubmitted,
        coding_score: codingScore,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in resume-code-execute:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
