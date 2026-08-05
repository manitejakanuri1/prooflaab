import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { guard } from '../_shared/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WANDBOX_URL = 'https://wandbox.org/api/compile.json';

// Piston's public API went whitelist-only; Wandbox is the free, no-auth
// alternative. Maps our internal language name to a Wandbox compiler name.
const WANDBOX_COMPILER: Record<string, string> = {
  python: 'cpython-3.11.10',
  java: 'openjdk-jdk-21+35',
  javascript: 'nodejs-20.17.0',
  cpp: 'gcc-13.2.0',
  c: 'gcc-13.2.0-c',
  go: 'go-1.23.2',
  ruby: 'ruby-3.4.9',
  php: 'php-8.3.12',
};

interface TestCase {
  stdin: string;
  expected_output: string;
}

async function runCode(language: string, code: string, stdin: string): Promise<{ stdout: string; stderr: string }> {
  const compiler = WANDBOX_COMPILER[language] || WANDBOX_COMPILER.python;
  const res = await fetch(WANDBOX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, compiler, stdin }),
  });
  if (!res.ok) {
    throw new Error(`Code execution failed: ${res.status}`);
  }
  const data = await res.json();
  return {
    stdout: data.program_output ?? '',
    stderr: data.compiler_error || data.program_error || '',
  };
}

serve(async (req) => {
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
      try {
        const { stdout, stderr } = await runCode(question.language, code, tc.stdin);
        const passed = stdout.trim() === tc.expected_output.trim();
        results.push({ stdin: tc.stdin, expected: tc.expected_output, actual: stdout.trim(), stderr: stderr.trim(), passed });
      } catch (e) {
        results.push({ stdin: tc.stdin, expected: tc.expected_output, actual: '', stderr: String(e), passed: false });
      }
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
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
