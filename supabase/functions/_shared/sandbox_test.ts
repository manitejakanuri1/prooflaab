import { outputsMatch, runCode, verdictFor } from './sandbox.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test('checker modes are deterministic and bounded', () => {
  assert(outputsMatch('hello\n', 'hello', 'exact'), 'exact should ignore the final newline');
  assert(!outputsMatch('hello world', 'hello  world', 'exact'), 'exact unexpectedly normalized internal whitespace');

  assert(outputsMatch('1   2\n3', '1 2 3', 'tokens'), 'tokens should normalize whitespace');
  assert(!outputsMatch('2 1 3', '1 2 3', 'tokens'), 'tokens ignored token order');

  assert(outputsMatch('pear apple apple', 'apple pear apple', 'unordered_tokens'), 'unordered tokens rejected same multiset');
  assert(!outputsMatch('pear apple', 'apple pear apple', 'unordered_tokens'), 'unordered tokens ignored duplicate count');

  assert(outputsMatch('beta\nalpha', 'alpha\nbeta', 'unordered_lines'), 'unordered lines rejected reordered lines');
  assert(!outputsMatch('alpha\nbeta', 'alpha\ngamma', 'unordered_lines'), 'unordered lines accepted different content');

  assert(outputsMatch('3.1415927', '3.1415926', 'numeric_tolerance', 1e-6), 'numeric tolerance rejected close values');
  assert(!outputsMatch('3.15', '3.14', 'numeric_tolerance', 1e-6), 'numeric tolerance accepted distant values');
  assert(!outputsMatch('value=3.14', '3.14', 'numeric_tolerance', 1e-6), 'numeric checker accepted non-numeric output');

  // Even if an old/manual row contains an unknown checker, it fails closed to exact.
  assert(outputsMatch('a b', 'a b', 'not-a-checker'), 'invalid checker did not fall back to exact');
  assert(!outputsMatch('a   b', 'a b', 'not-a-checker'), 'invalid checker gained permissive semantics');

  // A maliciously loose stored tolerance is capped at 1e-3 at runtime.
  assert(!outputsMatch('101', '100', 'numeric_tolerance', 999), 'numeric tolerance was not defensively capped');

  assert(verdictFor('runtime_error', '1', '1', 'exact') === 'runtime_error', 'runtime error was hidden by checker');
  assert(verdictFor('ok', '2 1', '1 2', 'unordered_tokens') === 'accepted', 'verdict did not use checker');
});

/** Runs fn with fetch recorded (and failing), and the given env overrides. */
async function withFetchSpy(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<string[]> {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v);
  }
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(new Response('busy', { status: 503 }));
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v);
    }
  }
  return calls;
}

Deno.test('F10: graded code never reaches a public runner by default', async () => {
  let result: Awaited<ReturnType<typeof runCode>> | null = null;
  const calls = await withFetchSpy(
    { CODE_RUNNER_URL: 'https://own-runner.invalid', CODE_RUNNER_SECRET: 's', PUBLIC_RUNNER_FALLBACK: undefined },
    async () => { result = await runCode('python', 'print(input())', 'HIDDEN-TEST-INPUT'); },
  );
  assert(result !== null && !(result as { ok: boolean }).ok, 'a busy own runner must give ok:false');
  // 1 call + 3 busy retries, all to our own runner
  assert(calls.length === 4 && calls.every((u) => u.startsWith('https://own-runner.invalid')), `unexpected calls: ${calls.join(', ')}`);
  assert(!calls.some((u) => /wandbox|godbolt|glot/.test(u)), 'hidden test input was sent to a public runner');
});

Deno.test('F10: production never reaches a public runner, even with the override set', async () => {
  for (const env of ['production', undefined, 'prod', '']) {
    const calls = await withFetchSpy(
      { CODE_RUNNER_URL: 'https://own-runner.invalid', CODE_RUNNER_SECRET: 's', PUBLIC_RUNNER_FALLBACK: 'allow', ENVIRONMENT: env },
      async () => { await runCode('python', 'print(input())', 'HIDDEN'); },
    );
    assert(!calls.some((u) => /wandbox|godbolt|glot/.test(u)), `ENVIRONMENT=${env} reached a public runner`);
  }
});

Deno.test('F10: public runners only when explicitly allowed in staging/development', async () => {
  const calls = await withFetchSpy(
    { CODE_RUNNER_URL: 'https://own-runner.invalid', CODE_RUNNER_SECRET: 's', PUBLIC_RUNNER_FALLBACK: 'allow', ENVIRONMENT: 'staging' },
    async () => { await runCode('python', 'print(1)', ''); },
  );
  assert(calls.some((u) => u.includes('wandbox')), 'opt-in fallback did not reach wandbox');
});

Deno.test('a busy own runner is retried, and a later free instance gives the real result', async () => {
  const realFetch = globalThis.fetch;
  const saved = { u: Deno.env.get('CODE_RUNNER_URL'), s: Deno.env.get('CODE_RUNNER_SECRET') };
  Deno.env.set('CODE_RUNNER_URL', 'https://own-runner.invalid'); Deno.env.set('CODE_RUNNER_SECRET', 's');
  let n = 0;
  globalThis.fetch = (() => Promise.resolve(++n <= 2
    ? new Response('busy', { status: 429 })
    : new Response(JSON.stringify({ status: 'ok', stdout: '42', stderr: '' }), { status: 200 }))) as typeof fetch;
  try {
    const r = await runCode('python', 'print(42)', '');
    assert(r.ok && (r as { stdout: string }).stdout === '42', `expected the real result after retries, got ${JSON.stringify(r)}`);
    assert(n === 3, `expected 2 busy answers then success, saw ${n} calls`);
  } finally {
    globalThis.fetch = realFetch;
    if (saved.u === undefined) Deno.env.delete('CODE_RUNNER_URL'); else Deno.env.set('CODE_RUNNER_URL', saved.u);
    if (saved.s === undefined) Deno.env.delete('CODE_RUNNER_SECRET'); else Deno.env.set('CODE_RUNNER_SECRET', saved.s);
  }
});
