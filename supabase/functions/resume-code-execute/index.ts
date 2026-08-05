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

const GODBOLT_URL = 'https://godbolt.org/api/compiler';

/**
 * Second runner, used only when Wandbox cannot start a container.
 *
 * Deliberately incomplete. Verified to execute with stdin and match Wandbox's
 * behaviour for these five. Java would not execute at all, Godbolt's JavaScript
 * is a bare V8 shell with no require or Node APIs, and PHP is not offered — so
 * correct student code would fail there for reasons that have nothing to do with
 * the student. Falling back into a subtly different environment would recreate
 * exactly the bug this is meant to fix, so those languages have no fallback and
 * report the runner as unavailable instead.
 */
const GODBOLT_COMPILER: Record<string, string> = {
  python: 'python313',
  cpp: 'g152',
  c: 'cg152',
  ruby: 'ruby405',
  go: 'gl194',
};

/**
 * Third runner, and the only one that covers Java, JavaScript and PHP.
 *
 * Off unless GLOT_API_TOKEN is set, because Glot requires a (free) account and
 * an unauthenticated call just returns "a valid access token is required". With
 * no token the chain behaves exactly as before: Wandbox, then Godbolt where it
 * fits, then an honest "the runner is down".
 *
 * NOT YET EXERCISED against a real token — every code path here is written from
 * Glot's documented shape, not from a live response. It is deliberately last in
 * the chain and fails into the same honest refusal, so an unexpected shape costs
 * a retry rather than a wrong score.
 */
const GLOT_URL = 'https://glot.io/api/run';

const GLOT_LANGUAGE: Record<string, { lang: string; file: string }> = {
  javascript: { lang: 'javascript', file: 'main.js' },
  // Glot compiles by filename; Java needs the public class to match.
  java: { lang: 'java', file: 'Main.java' },
  php: { lang: 'php', file: 'main.php' },
  python: { lang: 'python', file: 'main.py' },
  c: { lang: 'c', file: 'main.c' },
  cpp: { lang: 'cpp', file: 'main.cpp' },
  go: { lang: 'go', file: 'main.go' },
  ruby: { lang: 'ruby', file: 'main.rb' },
};

interface TestCase {
  stdin: string;
  expected_output: string;
}

/**
 * A run that produced a result — the code executed, whatever it printed — or an
 * infrastructure failure where it never ran at all.
 *
 * Keeping these apart is the whole point. Treating them the same is what scored
 * a student 0 out of 6 for six containers that never started.
 */
/**
 * How the run ended, when it ended at all.
 *
 * "It failed" is not feedback. A wrong answer means the logic is off, a crash
 * means something threw, a timeout means the logic may be right but too slow,
 * and a compile error is usually a typo. Collapsing four different lessons into
 * one red cross teaches none of them.
 */
type ExecStatus = 'ok' | 'compile_error' | 'runtime_error' | 'time_limit';

type RunResult =
  | { ok: true; status: ExecStatus; stdout: string; stderr: string }
  | { ok: false; reason: string };

/** What a single test case ended up being worth, once compared. */
type Verdict = 'accepted' | 'wrong_answer' | 'runtime_error' | 'compile_error' | 'time_limit';

function verdictFor(status: ExecStatus, stdout: string, expected: string): Verdict {
  if (status === 'compile_error') return 'compile_error';
  if (status === 'runtime_error') return 'runtime_error';
  if (status === 'time_limit') return 'time_limit';
  return stdout.trim() === expected.trim() ? 'accepted' : 'wrong_answer';
}

/** Runners signal a killed process in prose rather than in a field. */
const TIMEOUT_PATTERNS = ['timeout', 'timed out', 'killed', 'terminated', 'sigkill', 'sigxcpu'];

function looksLikeTimeout(text: string): boolean {
  const t = text.toLowerCase();
  return TIMEOUT_PATTERNS.some((p) => t.includes(p));
}

/**
 * Signs that the runner itself failed rather than the code.
 *
 * "Resource temporarily unavailable" from clone() means the host had no process
 * slots left. Exit 126 is the shell's "command cannot execute". None of these
 * can be caused by anything a student types.
 */
const INFRA_PATTERNS = [
  'oci runtime',
  'crun',
  'resource temporarily unavailable',
  'cannot allocate memory',
  'too many open files',
  'no space left on device',
  'container',
];

function looksLikeInfraFailure(text: string): boolean {
  const t = text.toLowerCase();
  return INFRA_PATTERNS.some((p) => t.includes(p));
}

async function runOnWandbox(language: string, code: string, stdin: string): Promise<RunResult> {
  const compiler = WANDBOX_COMPILER[language] || WANDBOX_COMPILER.python;
  const res = await fetch(WANDBOX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, compiler, stdin }),
  });
  if (!res.ok) return { ok: false, reason: `wandbox http ${res.status}` };

  const data = await res.json();
  const stderr = data.compiler_error || data.program_error || '';
  const combined = `${stderr} ${data.compiler_message ?? ''}`;

  // 126 is "cannot execute". Wandbox reports the container failure here, not as
  // an HTTP error, so a plain res.ok check sails straight past it.
  if (String(data.status) === '126' || looksLikeInfraFailure(combined)) {
    return { ok: false, reason: combined.trim() || 'runner could not start' };
  }

  const compilerError = String(data.compiler_error ?? '');
  const programError = String(data.program_error ?? '');
  const exitCode = String(data.status ?? '0');

  let status: ExecStatus = 'ok';
  if (data.signal || looksLikeTimeout(programError)) {
    status = 'time_limit';
  } else if (compilerError.trim()) {
    // Only compiled languages report here. A Python or JavaScript syntax error
    // arrives as a non-zero exit instead, which is why the runner's own message
    // is always passed through — "SyntaxError: line 4" says more than any label
    // this could invent.
    status = 'compile_error';
  } else if (exitCode !== '0') {
    status = 'runtime_error';
  }

  return { ok: true, status, stdout: data.program_output ?? '', stderr };
}

async function runOnGodbolt(language: string, code: string, stdin: string): Promise<RunResult> {
  const compiler = GODBOLT_COMPILER[language];
  if (!compiler) return { ok: false, reason: 'no fallback runner for this language' };

  const res = await fetch(`${GODBOLT_URL}/${compiler}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      source: code,
      options: {
        userArguments: '',
        executeParameters: { args: [], stdin },
        compilerOptions: { executorRequest: true },
        filters: { execute: true },
      },
    }),
  });
  if (!res.ok) return { ok: false, reason: `godbolt http ${res.status}` };

  const data = await res.json();
  const join = (parts: unknown) =>
    Array.isArray(parts) ? parts.map((p: { text?: string }) => p?.text ?? '').join('\n') : '';

  // Godbolt separates the build from the run, so a compile failure is a fact
  // here rather than something to infer from the text.
  const buildCode = data.buildResult?.code;
  if (typeof buildCode === 'number' && buildCode !== 0) {
    return {
      ok: true,
      status: 'compile_error',
      stdout: '',
      stderr: join(data.buildResult?.stderr) || 'compilation failed',
    };
  }

  if (data.didExecute !== true) {
    return { ok: false, reason: 'fallback runner could not execute' };
  }

  const stderr = join(data.stderr);
  let status: ExecStatus = 'ok';
  if (data.timedOut === true) status = 'time_limit';
  else if (typeof data.code === 'number' && data.code !== 0) status = 'runtime_error';

  return { ok: true, status, stdout: join(data.stdout), stderr };
}

async function runOnGlot(language: string, code: string, stdin: string): Promise<RunResult> {
  const token = Deno.env.get('GLOT_API_TOKEN');
  if (!token) return { ok: false, reason: 'glot not configured' };

  const target = GLOT_LANGUAGE[language];
  if (!target) return { ok: false, reason: 'glot has no runtime for this language' };

  const res = await fetch(`${GLOT_URL}/${target.lang}/latest`, {
    method: 'POST',
    // Confirmed against a live token: Authorization is the header Glot reads,
    // and X-Access-Token returns 401 on its own.
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
    body: JSON.stringify({ stdin, files: [{ name: target.file, content: code }] }),
  });
  if (!res.ok) return { ok: false, reason: `glot http ${res.status}` };

  const data = await res.json();
  const stderr = String(data.stderr ?? '');
  const glotError = String(data.error ?? '');

  // Glot reports a killed process through `error`. Anything else in there is a
  // failure of the service, not of the code.
  if (glotError && looksLikeTimeout(glotError)) {
    return { ok: true, status: 'time_limit', stdout: data.stdout ?? '', stderr };
  }
  if (glotError) return { ok: false, reason: `glot: ${glotError}` };

  // Glot does not separate build from run, so a crash and a failed compile look
  // alike here. Reported as a runtime error with the real message attached
  // rather than guessed at from the text.
  const status: ExecStatus = stderr.trim() && !String(data.stdout ?? '').trim() ? 'runtime_error' : 'ok';

  return { ok: true, status, stdout: data.stdout ?? '', stderr };
}

/**
 * Runs one test case, trying hard to get an honest answer before giving up.
 *
 * Wandbox first and twice, because "temporarily unavailable" often is. Then the
 * fallback, where one exists for the language. Only when every route fails does
 * this report a failure of the runner, which the caller treats as "not graded"
 * rather than "wrong".
 */
async function runCode(language: string, code: string, stdin: string): Promise<RunResult> {
  let lastReason = 'runner unavailable';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await runOnWandbox(language, code, stdin);
      if (result.ok) return result;
      lastReason = result.reason;
    } catch (e) {
      lastReason = String(e);
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
  }

  try {
    const fallback = await runOnGodbolt(language, code, stdin);
    if (fallback.ok) return fallback;
    lastReason = `${lastReason}; ${fallback.reason}`;
  } catch (e) {
    lastReason = `${lastReason}; ${String(e)}`;
  }

  // Last, and the only route for Java, JavaScript and PHP. Skips itself when no
  // token is configured.
  try {
    const glot = await runOnGlot(language, code, stdin);
    if (glot.ok) return glot;
    lastReason = `${lastReason}; ${glot.reason}`;
  } catch (e) {
    lastReason = `${lastReason}; ${String(e)}`;
  }

  console.error(`Both runners failed for ${language}: ${lastReason}`);
  return { ok: false, reason: lastReason };
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
      const run = await runCode(question.language, code, tc.stdin);

      // The runner never started. Stop here rather than recording a failure the
      // student did not earn — and stop immediately, because if one container
      // could not start the next five will not either.
      if (!run.ok) {
        return new Response(
          JSON.stringify({
            error: 'The code runner is busy right now. This is not a problem with your code — please try again in a moment.',
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
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
