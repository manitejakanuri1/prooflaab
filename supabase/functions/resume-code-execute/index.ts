import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { guard } from '../_shared/rate-limit.ts';
import { cors } from "../_shared/cors.ts";
import { runCode, verdictFor, type TestCase } from "../_shared/sandbox.ts";

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
    if (!assessment_id || !question_id || typeof code !== 'string' || !['run', 'submit'].includes(mode)) {
      return new Response(
        JSON.stringify({ error: 'assessment_id, question_id, code, and mode ("run"|"submit") are required' }),
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
    if (mode === 'submit' && existingResults[question_id]) {
      return new Response(
        JSON.stringify({ error: 'This question has already been submitted' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const testCases: TestCase[] = mode === 'run'
      ? [question.test_cases[0]]
      : question.test_cases;

    const results = [];
    for (const tc of testCases) {
      const run = await runCode(question.language, code, tc.stdin);

      // The runner never started. Stop here rather than recording a failure the
      // student did not earn — and stop immediately, because if one container
      // could not start the next five will not either.
      if (!run.ok) {
        return new Response(
          JSON.stringify({
            error: 'The code runner is busy right now. This is not a problem with your code - please try again in a moment.',
            runner_unavailable: true,
            detail: run.reason,
          }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const verdict = verdictFor(run.status, run.stdout, tc.expected_output);
      results.push({
        stdin: tc.stdin,
        expected: tc.expected_output,
        actual: run.stdout.trim(),
        stderr: run.stderr.trim(),
        verdict,
        passed: verdict === 'accepted',
      });

      // Code that will not build will not build for the next case either.
      // Reported once, the way a compiler reports it, instead of repeating the
      // same message per test and spending runs to say nothing new.
      if (verdict === 'compile_error') break;
    }

    if (mode === 'run') {
      return new Response(
        JSON.stringify({ success: true, results }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // submit mode: persist this question's result, and if all coding questions
    // are now submitted, compute the final coding score onto the scorecard.
    const passCount = results.filter(r => r.passed).length;
    const updatedResults = {
      ...existingResults,
      [question_id]: { pass_count: passCount, total: results.length, results },
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
        total: results.length,
        results,
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
