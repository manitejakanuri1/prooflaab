// Shared code runner. Extracted from resume-code-execute (stage69) so
// run-sandbox and submit-sandbox-task use the exact same fallback chain
// instead of a second copy that could drift.
//
// Order: Wandbox (tried twice), then Godbolt where it has a fit, then Glot
// (only when GLOT_API_TOKEN is configured). Piston's public API went
// whitelist-only, hence Wandbox as primary.

const WANDBOX_URL = 'https://wandbox.org/api/compile.json';

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
 * Deliberately incomplete. Java would not execute at all, Godbolt's
 * JavaScript is a bare V8 shell with no require or Node APIs, and PHP is not
 * offered — so those languages have no fallback and report the runner as
 * unavailable instead of recreating this same bug in a different runner.
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
 * Off unless GLOT_API_TOKEN is set.
 */
const GLOT_URL = 'https://glot.io/api/run';

const GLOT_LANGUAGE: Record<string, { lang: string; file: string }> = {
  javascript: { lang: 'javascript', file: 'main.js' },
  java: { lang: 'java', file: 'Main.java' },
  php: { lang: 'php', file: 'main.php' },
  python: { lang: 'python', file: 'main.py' },
  c: { lang: 'c', file: 'main.c' },
  cpp: { lang: 'cpp', file: 'main.cpp' },
  go: { lang: 'go', file: 'main.go' },
  ruby: { lang: 'ruby', file: 'main.rb' },
};

/**
 * Java compiles by filename, and the generated starter code declares
 * `class Solution` rather than Main. Submitting it as Main.java produced a
 * Solution.class with no Main to run, so every Java submission came back as
 * "Exit code: 1" no matter how correct it was.
 */
function glotFileName(language: string, code: string, fallback: string): string {
  if (language !== 'java') return fallback;
  const named = code.match(/(?:public\s+)?class\s+([A-Za-z_]\w*)/);
  return named ? `${named[1]}.java` : fallback;
}

export interface TestCase {
  stdin: string;
  expected_output: string;
}

/** How the run ended, when it ended at all. */
export type ExecStatus = 'ok' | 'compile_error' | 'runtime_error' | 'time_limit';

export type RunResult =
  | { ok: true; status: ExecStatus; stdout: string; stderr: string; runner: string }
  | { ok: false; reason: string };

/** What a single test case ended up being worth, once compared. */
export type Verdict = 'accepted' | 'wrong_answer' | 'runtime_error' | 'compile_error' | 'time_limit';

export function verdictFor(status: ExecStatus, stdout: string, expected: string): Verdict {
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

/** Signs that the runner itself failed rather than the code. */
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

/** 15s ceiling on every runner HTTP call — a hung runner used to hang the whole request. */
function withTimeout(ms = 15000): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function runOnWandbox(language: string, code: string, stdin: string): Promise<RunResult> {
  const compiler = WANDBOX_COMPILER[language] || WANDBOX_COMPILER.python;
  const res = await fetch(WANDBOX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, compiler, stdin }),
    signal: withTimeout(),
  });
  if (!res.ok) return { ok: false, reason: `wandbox http ${res.status}` };

  const data = await res.json();
  const stderr = data.compiler_error || data.program_error || '';
  const combined = `${stderr} ${data.compiler_message ?? ''}`;

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
    status = 'compile_error';
  } else if (exitCode !== '0') {
    status = 'runtime_error';
  }

  return { ok: true, status, stdout: data.program_output ?? '', stderr, runner: 'wandbox' };
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
    signal: withTimeout(),
  });
  if (!res.ok) return { ok: false, reason: `godbolt http ${res.status}` };

  const data = await res.json();
  const join = (parts: unknown) =>
    Array.isArray(parts) ? parts.map((p: { text?: string }) => p?.text ?? '').join('\n') : '';

  const buildCode = data.buildResult?.code;
  if (typeof buildCode === 'number' && buildCode !== 0) {
    return {
      ok: true,
      status: 'compile_error',
      stdout: '',
      stderr: join(data.buildResult?.stderr) || 'compilation failed',
      runner: 'godbolt',
    };
  }

  if (data.didExecute !== true) {
    return { ok: false, reason: 'fallback runner could not execute' };
  }

  const stderr = join(data.stderr);
  let status: ExecStatus = 'ok';
  if (data.timedOut === true) status = 'time_limit';
  else if (typeof data.code === 'number' && data.code !== 0) status = 'runtime_error';

  return { ok: true, status, stdout: join(data.stdout), stderr, runner: 'godbolt' };
}

async function runOnGlot(language: string, code: string, stdin: string): Promise<RunResult> {
  const token = Deno.env.get('GLOT_API_TOKEN');
  if (!token) return { ok: false, reason: 'glot not configured' };

  const target = GLOT_LANGUAGE[language];
  if (!target) return { ok: false, reason: 'glot has no runtime for this language' };

  const res = await fetch(`${GLOT_URL}/${target.lang}/latest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
    body: JSON.stringify({
      stdin,
      files: [{ name: glotFileName(language, code, target.file), content: code }],
    }),
    signal: withTimeout(),
  });
  if (!res.ok) return { ok: false, reason: `glot http ${res.status}` };

  const data = await res.json();
  const stderr = String(data.stderr ?? '');
  const glotError = String(data.error ?? '');

  if (glotError && looksLikeTimeout(glotError)) {
    return { ok: true, status: 'time_limit', stdout: data.stdout ?? '', stderr, runner: 'glot' };
  }

  if (glotError && !/^exit code:/i.test(glotError.trim())) {
    return { ok: false, reason: `glot: ${glotError}` };
  }

  const failed = Boolean(glotError) || (stderr.trim() && !String(data.stdout ?? '').trim());
  const status: ExecStatus = failed ? 'runtime_error' : 'ok';

  return { ok: true, status, stdout: data.stdout ?? '', stderr, runner: 'glot' };
}

/**
 * ProofLab's own runner on Cloud Run (code-runner/), used first whenever
 * CODE_RUNNER_URL and CODE_RUNNER_SECRET are set. It covers all eight
 * languages, so the free public runners below become a fallback rather than the
 * only way code ever ran - they were, until Wandbox went down for every
 * language on 16 Sep 2026 and students could not run code at all.
 */
export async function runOnOwnRunner(language: string, code: string, stdin: string): Promise<RunResult> {
  const url = Deno.env.get('CODE_RUNNER_URL');
  const secret = Deno.env.get('CODE_RUNNER_SECRET');
  if (!url || !secret) return { ok: false, reason: 'own runner not configured' };

  const res = await fetch(`${url.replace(/\/$/, '')}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-runner-secret': secret },
    body: JSON.stringify({ language, code, stdin }),
    signal: withTimeout(70000),
  });
  if (!res.ok) return { ok: false, reason: `own runner http ${res.status}` };
  const data = await res.json();
  const status = data.status as ExecStatus;
  if (!['ok', 'compile_error', 'runtime_error', 'time_limit'].includes(status)) {
    return { ok: false, reason: 'own runner gave no status' };
  }
  return { ok: true, status, stdout: data.stdout ?? '', stderr: data.stderr ?? '', runner: 'prooflab' };
}

/**
 * Runs one test case, trying hard to get an honest answer before giving up.
 * Our own runner first, then Wandbox twice, then Godbolt where it fits, then Glot.
 */
export async function runCode(language: string, code: string, stdin: string): Promise<RunResult> {
  let lastReason = 'runner unavailable';

  try {
    const own = await runOnOwnRunner(language, code, stdin);
    if (own.ok) return own;
    lastReason = own.reason;
  } catch (e) {
    lastReason = `own runner: ${String(e)}`;
  }

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

// ---------------------------------------------------------------------------
// Test-case grading (new in stage69, built on the runner above)
// ---------------------------------------------------------------------------

export interface SandboxTest {
  id: string;
  stdin: string;
  expected_output: string;
  visible: boolean;
  weight?: number;
}

export interface GradedTest {
  id: string;
  visible: boolean;
  verdict: Verdict;
  passed: boolean;
  stdin?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
}

export type Graded =
  | { ok: true; results: GradedTest[]; passedCount: number; score: number; runner: string }
  | { ok: false; reason: string };

/**
 * Runs every test and scores by weight. A compile error stops the run — the
 * next test would not build either — and the tests it never reached count as
 * failed, so the denominator is always the full set. Hidden tests keep their
 * raw stdin/expected/actual here; callers must call redact() before this
 * leaves the server.
 */
export async function gradeTests(language: string, code: string, tests: SandboxTest[]): Promise<Graded> {
  const results: GradedTest[] = [];
  let runner = '';
  let compileError: { stderr: string } | null = null;

  for (const tc of tests) {
    if (compileError) {
      results.push({ id: tc.id, visible: tc.visible, verdict: 'compile_error', passed: false, stderr: compileError.stderr });
      continue;
    }
    const run = await runCode(language, code, tc.stdin);
    if (!run.ok) return { ok: false, reason: run.reason }; // never grade a run that did not happen
    runner = run.runner;
    const verdict = verdictFor(run.status, run.stdout, tc.expected_output);
    results.push({
      id: tc.id, visible: tc.visible, verdict, passed: verdict === 'accepted',
      stdin: tc.stdin, expected: tc.expected_output, actual: run.stdout.trim(), stderr: run.stderr.trim(),
    });
    if (verdict === 'compile_error') compileError = { stderr: run.stderr.trim() };
  }

  const total = tests.reduce((s, t) => s + (t.weight ?? 1), 0);
  const earned = tests.reduce((s, t, i) => s + (results[i].passed ? (t.weight ?? 1) : 0), 0);
  return {
    ok: true,
    results,
    passedCount: results.filter((r) => r.passed).length,
    score: total > 0 ? Math.round((earned / total) * 100) : 0,
    runner,
  };
}

/** What a student may see: a hidden test keeps only its verdict. */
export function redact(results: GradedTest[]) {
  return results.map((r) => (r.visible ? r : { id: r.id, visible: false, verdict: r.verdict, passed: r.passed }));
}
