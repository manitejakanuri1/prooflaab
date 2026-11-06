// What the grader sends to the runner for answers with helper files, with the runner faked.
import { gradeSandboxConfig, redact, sanitizeStderr, type SandboxTest } from "./sandbox.ts";

function assertEquals(actual: unknown, expected: unknown, note = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${note} expected ${e}, got ${a}`);
}

const tests: SandboxTest[] = [
  { id: "t1", stdin: "1", expected_output: "ok", visible: true },
  { id: "t2", stdin: "secret-input", expected_output: "secret-output", visible: false },
];
const BUNDLE = "from reportlib import x\nprint(x)\n#==prooflab-file== reportlib.py\nx = 'ok'\n";

// deno-lint-ignore no-explicit-any
async function grade(language: string, code: string, reply: (body: any) => Record<string, unknown>) {
  Deno.env.set("CODE_RUNNER_URL", "https://runner.test");
  Deno.env.set("CODE_RUNNER_SECRET", "s");
  Deno.env.delete("CODE_RUNNER_AUTH");
  const sent: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push(body);
    return Promise.resolve(new Response(JSON.stringify(reply(body))));
  }) as typeof fetch;
  try {
    const graded = await gradeSandboxConfig({ kind: "stdio", language, test_cases: tests }, code);
    return { graded, sent };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const passes = () => ({ status: "ok", stdout: "ok", stderr: "" });

Deno.test("python with a helper: the main program and the file are sent apart, every test", async () => {
  const { sent } = await grade("python", BUNDLE, passes);
  assertEquals(sent.length, 2);
  for (const body of sent) {
    assertEquals(body.code, "from reportlib import x\nprint(x)");
    assertEquals(body.files, [{ name: "reportlib.py", content: "x = 'ok'\n" }]);
  }
});

Deno.test("an old one-file python answer is sent exactly as before, with no files field", async () => {
  const code = "print('ok')\n";
  const { sent } = await grade("python", code, passes);
  assertEquals(sent[0].code, code);
  assertEquals("files" in sent[0], false);
});

Deno.test("an unsafe marker name is sent as plain code, so no file is ever made", async () => {
  const code = "print('ok')\n#==prooflab-file== ../x.py\nprint(2)";
  const { sent } = await grade("python", code, passes);
  assertEquals(sent[0].code, code);
  assertEquals("files" in sent[0], false);
});

Deno.test("other languages never split, even with a marker line", async () => {
  for (const language of ["javascript", "java", "c", "cpp", "go", "ruby", "php"]) {
    const { sent } = await grade(language, BUNDLE, passes);
    assertEquals(sent[0].code, BUNDLE, language);
    assertEquals("files" in sent[0], false, language);
  }
});

Deno.test("an empty main program with a helper still gets a real run, and a failed result", async () => {
  const { graded, sent } = await grade("python", "#==prooflab-file== a.py\nx = 1", () => ({ status: "ok", stdout: "", stderr: "" }));
  assertEquals(sent[0].code, "\n");
  assertEquals(graded.ok && graded.passedCount, 0);
});

Deno.test("a wrong two-file answer still fails, and the score counts every test", async () => {
  const { graded } = await grade("python", BUNDLE, (b) => ({ status: "ok", stdout: b.stdin === "1" ? "ok" : "wrong", stderr: "" }));
  assertEquals(graded.ok && graded.passedCount, 1);
  assertEquals(graded.ok && graded.score, 50);
});

Deno.test("a failing import stays a failed test", async () => {
  const { graded } = await grade("python", "from reportlib import x", () => ({
    status: "runtime_error",
    stdout: "",
    stderr: "ModuleNotFoundError: No module named 'reportlib'",
  }));
  assertEquals(graded.ok && graded.passedCount, 0);
});

Deno.test("hidden test details stay hidden after redaction with helper files", async () => {
  const { graded } = await grade("python", BUNDLE, passes);
  const text = JSON.stringify(graded.ok ? redact(graded.results) : null);
  assertEquals(text.includes("secret-input"), false);
  assertEquals(text.includes("secret-output"), false);
});

Deno.test("errors name the student's own files, never the runner's folder", () => {
  const raw = 'File "/tmp/run-abc123/main.py", line 1\nFile "/tmp/run-abc123/reportlib.py", line 2';
  assertEquals(sanitizeStderr(raw), 'File "solution.py", line 1\nFile "reportlib.py", line 2');
});
