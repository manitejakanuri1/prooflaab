import {
  gradeSandboxConfig,
  redact,
  type SandboxTest,
} from "./sandbox.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function withPrivateRunner(
  handler: (body: Record<string, unknown>) => Response,
  fn: () => Promise<void>,
) {
  const realFetch = globalThis.fetch;
  const saved = {
    u: Deno.env.get("CODE_RUNNER_URL"),
    s: Deno.env.get("CODE_RUNNER_SECRET"),
    a: Deno.env.get("CODE_RUNNER_AUTH"),
    e: Deno.env.get("ENVIRONMENT"),
    p: Deno.env.get("PUBLIC_RUNNER_FALLBACK"),
  };

  Deno.env.set("CODE_RUNNER_URL", "https://own-runner.invalid");
  Deno.env.set("CODE_RUNNER_SECRET", "c2-secret");
  Deno.env.delete("CODE_RUNNER_AUTH");
  Deno.env.set("ENVIRONMENT", "production");
  Deno.env.delete("PUBLIC_RUNNER_FALLBACK");

  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(handler(body));
  }) as typeof fetch;

  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;

    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    };

    restore("CODE_RUNNER_URL", saved.u);
    restore("CODE_RUNNER_SECRET", saved.s);
    restore("CODE_RUNNER_AUTH", saved.a);
    restore("ENVIRONMENT", saved.e);
    restore("PUBLIC_RUNNER_FALLBACK", saved.p);
  }
}

const LIMITS = {
  time_limit_ms: 1000,
  memory_limit_mb: 128,
};

Deno.test("C2.3: function grading executes trusted harness and accepts correct return", async () => {
  const tests: SandboxTest[] = [{
    id: "visible-1",
    stdin: "[20,22]",
    expected_output: "42",
    visible: true,
    weight: 1,
    checker: "exact",
  }];

  await withPrivateRunner((body) => {
    if (
      typeof body.stdin !== "string" ||
      body.stdin.length === 0
    ) {
      throw new Error("function arguments missing from runner stdin");
    }

    if (
      typeof body.code !== "string" ||
      !body.code.includes("add(") ||
      !body.code.includes("__prooflab_args")
    ) {
      throw new Error("trusted harness did not call function through runtime arguments");
    }

    const code = String(body.code ?? "");

    if (
      code.includes("add(20, 22)") ||
      code.includes("add(20,22)") ||
      code.includes("[20,22]")
    ) {
      throw new Error("function arguments leaked into generated source");
    }

    const match = code.match(/__PROOFLAB_FUNCTION_RESULT_[A-Za-z0-9_-]+__/);
    assert(match, "trusted result marker missing");

    return new Response(JSON.stringify({
      status: "ok",
      stdout: `${match[0]}{"ok":true,"value":42}\n`,
      stderr: "",
    }), { status: 200 });
  }, async () => {
    const graded = await gradeSandboxConfig({
      kind: "function",
      language: "python",
      function_spec: {
        function_name: "add",
        parameters: [
          { name: "a", type: "integer" },
          { name: "b", type: "integer" },
        ],
        return_type: "integer",
      },
      test_cases: tests,
      ...LIMITS,
    }, "def add(a, b):\n    return a + b");

    assert(graded.ok, `grading failed: ${JSON.stringify(graded)}`);
    assert(graded.score === 100, `expected score 100: ${JSON.stringify(graded)}`);
    assert(graded.passedCount === 1, "correct function did not pass");
    assert(graded.results[0].actual === "42", "canonical return value missing");
  });
});

Deno.test("C2.3: different correct source is graded by behaviour, not source similarity", async () => {
  const tests: SandboxTest[] = [{
    id: "t1",
    stdin: "[40,2]",
    expected_output: "42",
    visible: false,
    checker: "exact",
  }];

  await withPrivateRunner((body) => {
    const code = String(body.code ?? "");
    const match = code.match(/__PROOFLAB_FUNCTION_RESULT_[A-Za-z0-9_-]+__/);
    assert(match, "result marker missing");

    return new Response(JSON.stringify({
      status: "ok",
      stdout: `student debug\n${match[0]}{"ok":true,"value":42}\n`,
      stderr: "",
    }), { status: 200 });
  }, async () => {
    const graded = await gradeSandboxConfig({
      kind: "function",
      language: "python",
      function_spec: {
        function_name: "add",
        parameters: [
          { name: "a", type: "integer" },
          { name: "b", type: "integer" },
        ],
        return_type: "integer",
      },
      test_cases: tests,
      ...LIMITS,
    }, "def add(a,b):\n    return b+a");

    assert(graded.ok && graded.score === 100, "different correct implementation failed");

    const safe = redact(graded.results);
    assert(!("stdin" in safe[0]), "hidden function arguments leaked");
    assert(!("expected" in safe[0]), "hidden expected return leaked");
    assert(!("actual" in safe[0]), "hidden actual return leaked");
  });
});

Deno.test("C2.3: wrong function return is rejected", async () => {
  const tests: SandboxTest[] = [{
    id: "t1",
    stdin: "[20,22]",
    expected_output: "42",
    visible: true,
    checker: "exact",
  }];

  await withPrivateRunner((body) => {
    const code = String(body.code ?? "");
    const match = code.match(/__PROOFLAB_FUNCTION_RESULT_[A-Za-z0-9_-]+__/);
    assert(match, "result marker missing");

    return new Response(JSON.stringify({
      status: "ok",
      stdout: `${match[0]}{"ok":true,"value":41}\n`,
      stderr: "",
    }), { status: 200 });
  }, async () => {
    const graded = await gradeSandboxConfig({
      kind: "function",
      language: "python",
      function_spec: {
        function_name: "add",
        parameters: [
          { name: "a", type: "integer" },
          { name: "b", type: "integer" },
        ],
        return_type: "integer",
      },
      test_cases: tests,
      ...LIMITS,
    }, "def add(a,b): return 41");

    assert(graded.ok, "runner result was not graded");
    assert(graded.score === 0, "wrong function received credit");
    assert(graded.results[0].verdict === "wrong_answer", "wrong verdict");
  });
});

Deno.test("C2.3: malformed function evaluator fails before runner execution", async () => {
  let calls = 0;

  await withPrivateRunner((_body) => {
    calls++;
    return new Response("{}", { status: 500 });
  }, async () => {
    const graded = await gradeSandboxConfig({
      kind: "function",
      language: "python",
      function_spec: {
        function_name: "bad name()",
        parameters: [],
        return_type: "integer",
      },
      test_cases: [{
        id: "t1",
        stdin: "[]",
        expected_output: "1",
        visible: true,
      }],
      ...LIMITS,
    }, "pass");

    assert(!graded.ok, "malformed evaluator was accepted");
    assert(calls === 0, "runner was called for malformed evaluator");
  });
});

Deno.test("C2.3: legacy config with no kind remains stdio", async () => {
  await withPrivateRunner((body) => {
    assert(body.stdin === "21\n", "legacy stdin changed");
    assert(body.code === "print(int(input()) * 2)", "legacy code changed");

    return new Response(JSON.stringify({
      status: "ok",
      stdout: "42\n",
      stderr: "",
    }), { status: 200 });
  }, async () => {
    const graded = await gradeSandboxConfig({
      language: "python",
      test_cases: [{
        id: "old",
        stdin: "21\n",
        expected_output: "42",
        visible: true,
      }],
      ...LIMITS,
    }, "print(int(input()) * 2)");

    assert(graded.ok && graded.score === 100, "legacy stdio compatibility broke");
  });
});


Deno.test("C2-B2-A3 identical source and output limit", async () => {
  const seenSource: string[] = [];

  const tests: SandboxTest[] = [
    {
      id: "visible-a",
      stdin: "[1,2]",
      expected_output: "3",
      visible: true,
      weight: 1,
      checker: "exact",
    },
    {
      id: "hidden-b",
      stdin: "[2,3]",
      expected_output: "5",
      visible: false,
      weight: 1,
      checker: "exact",
    },
  ];

  await withPrivateRunner((body) => {
    const code = String(body.code ?? "");
    const stdin = String(body.stdin ?? "");

    seenSource.push(code);

    assert(
      !code.includes("[1,2]") &&
        !code.includes("[2,3]"),
      "runtime arguments leaked into generated source",
    );

    const match = code.match(
      /__PROOFLAB_FUNCTION_RESULT_[A-Za-z0-9_-]+__/,
    );

    assert(match, "trusted result marker missing");

    const args = JSON.parse(stdin) as number[];
    const value = args[0] + args[1];

    return new Response(
      JSON.stringify({
        status: "ok",
        stdout: `${match[0]}{"ok":true,"value":${value}}\n`,
        stderr: "",
        stdout_truncated: false,
        stderr_truncated: false,
      }),
      { status: 200 },
    );
  }, async () => {
    const graded = await gradeSandboxConfig({
      kind: "function",
      language: "python",
      function_spec: {
        function_name: "add",
        parameters: [
          { name: "a", type: "integer" },
          { name: "b", type: "integer" },
        ],
        return_type: "integer",
      },
      test_cases: tests,
      ...LIMITS,
    }, "def add(a, b):\n    return a + b");

    assert(
      graded.ok,
      `identity grading failed: ${JSON.stringify(graded)}`,
    );

    assert(
      graded.score === 100,
      `identity grading score changed: ${JSON.stringify(graded)}`,
    );
  });

  assert(
    seenSource.length === 2,
    `expected two runner calls, got ${seenSource.length}`,
  );

  assert(
    seenSource[0] === seenSource[1],
    "visible and hidden tests generated different program source",
  );
});

Deno.test("C2-B2-A3 truncated function stdout becomes output_limit", async () => {
  const tests: SandboxTest[] = [{
    id: "visible-output-limit",
    stdin: "[20,22]",
    expected_output: "42",
    visible: true,
    weight: 1,
    checker: "exact",
  }];

  await withPrivateRunner((body) => {
    assert(
      typeof body.stdin === "string" &&
        body.stdin === "[20,22]",
      "runtime stdin changed",
    );

    return new Response(
      JSON.stringify({
        status: "ok",
        stdout: "x".repeat(65536),
        stderr: "",
        stdout_truncated: true,
        stderr_truncated: false,
      }),
      { status: 200 },
    );
  }, async () => {
    const graded = await gradeSandboxConfig({
      kind: "function",
      language: "python",
      function_spec: {
        function_name: "add",
        parameters: [
          { name: "a", type: "integer" },
          { name: "b", type: "integer" },
        ],
        return_type: "integer",
      },
      test_cases: tests,
      ...LIMITS,
    }, "def add(a, b):\n    return a + b");

    assert(
      graded.ok,
      `output-limit grading failed: ${JSON.stringify(graded)}`,
    );

    assert(
      graded.results.length === 1,
      "output-limit result count changed",
    );

    assert(
      graded.results[0].verdict === "output_limit",
      `expected output_limit: ${JSON.stringify(graded)}`,
    );

    assert(
      graded.results[0].passed === false,
      "output-limit result unexpectedly passed",
    );
  });
});
