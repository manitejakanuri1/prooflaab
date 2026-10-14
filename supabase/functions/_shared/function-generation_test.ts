import { parseFunctionFields, sandboxConfigRow, type FunctionValidators } from "./function-generation.ts";
import type { StarterSpec, ValueType } from "./function-starter.ts";
import { checkFunctionTestQuality, type ProbeGrade } from "./test-quality.ts";

function assert(cond: boolean, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}
function assertEquals(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

// A small stand-in for function-mode.ts (the real contract is wired in auto-config.ts):
// identifiers, the eight types, int32 integers, finite numbers, one arg per parameter.
const TYPES = new Set(["integer", "number", "boolean", "string", "array<integer>", "array<number>", "array<boolean>", "array<string>"]);
const ok = (v: unknown, t: string): boolean => {
  if (t.startsWith("array<")) return Array.isArray(v) && v.every((x) => ok(x, t.slice(6, -1)));
  if (t === "integer") return Number.isInteger(v) && (v as number) >= -2147483648 && (v as number) <= 2147483647;
  if (t === "number") return typeof v === "number" && Number.isFinite(v);
  return typeof v === t;
};
const V: FunctionValidators = {
  parseSpec(raw) {
    const r = raw as Record<string, unknown>;
    const params = r.parameters as { name: string; type: string }[];
    if (typeof r.function_name !== "string" || !/^[a-z][A-Za-z0-9]*$/.test(r.function_name)) return null;
    if (!Array.isArray(params) || params.length > 8 || !TYPES.has(String(r.return_type))) return null;
    if (params.some((p) => !/^[a-z][A-Za-z0-9]*$/.test(p?.name) || !TYPES.has(p?.type))) return null;
    if (new Set(params.map((p) => p.name)).size !== params.length) return null;
    return { function_name: r.function_name, ...(r.class_name ? { class_name: String(r.class_name) } : {}), parameters: params as StarterSpec["parameters"], return_type: r.return_type as ValueType };
  },
  canonicalArgs(json, spec) {
    const a = JSON.parse(json);
    if (!Array.isArray(a) || a.length !== spec.parameters.length || !a.every((x, i) => ok(x, spec.parameters[i].type))) return null;
    return JSON.stringify(a);
  },
  canonicalValue(json, t) {
    const v = JSON.parse(json);
    return ok(v, t) ? JSON.stringify(v) : null;
  },
};

const spec = {
  function_name: "pairSum",
  parameters: [{ name: "nums", type: "array<integer>" }, { name: "target", type: "integer" }],
  return_type: "integer",
};
const reply = (over: Record<string, unknown> = {}) => ({
  language: "python",
  function_spec: spec,
  reference_solution: "def pairSum(nums, target):\n    return sum(nums) + target\n",
  buggy_solution: "def pairSum(nums, target):\n    return sum(nums)\n",
  starter_code: "import os; os.system('x')  # the model's starter must be ignored",
  test_cases: [
    { id: "t1", args: [[1, 2], 3], expected: 6, visible: true, kind: "normal", weight: 2 },
    { id: "t2", args: [[], 0], expected: 0, visible: false, kind: "boundary" },
    { id: "t3", args: [[-5, 5, 7], -1], expected: 6, visible: false, kind: "edge", checker: "numeric_tolerance" },
    { id: "t4", args: [[2147483647], 0], expected: 2147483647, visible: false, kind: "boundary" },
  ],
  ...over,
});

Deno.test("function reply -> canonical JSON tests, server starter, frozen spec", () => {
  const a = parseFunctionFields(reply(), V);
  assert(a !== null, "a valid reply parses");
  assertEquals(a!.kind, "function");
  assertEquals(a!.test_cases.map((t) => t.stdin), ["[[1,2],3]", "[[],0]", "[[-5,5,7],-1]", "[[2147483647],0]"]);
  assertEquals(a!.test_cases.map((t) => t.expected_output), ["6", "0", "6", "2147483647"]);
  assertEquals(a!.test_cases.map((t) => t.kind), ["normal", "boundary", "edge", "boundary"]);
  // numeric_tolerance is only for a number return; this one returns integer.
  assertEquals(a!.test_cases.map((t) => t.checker), ["exact", "exact", "exact", "exact"]);
  assert(a!.starter_code.startsWith("def pairSum(nums: list[int], target: int) -> int:"), "starter built from the spec");
  assert(!a!.starter_code.includes("os.system"), "the model's starter is never used");
  assertEquals(a!.function_spec.class_name, undefined);
});

Deno.test("Java always gets class Solution, whatever the model said", () => {
  const a = parseFunctionFields(reply({ language: "java", function_spec: { ...spec, class_name: "Evil" } }), V);
  assertEquals(a!.function_spec.class_name, "Solution");
  assert(a!.starter_code.startsWith("class Solution {"));
  const py = parseFunctionFields(reply({ function_spec: { ...spec, class_name: "Evil" } }), V);
  assertEquals(py!.function_spec.class_name, undefined);
});

Deno.test("invalid function replies are refused", () => {
  const bad: Record<string, Record<string, unknown>> = {
    "unknown language": { language: "rust" },
    "bad function name": { function_spec: { ...spec, function_name: "pair_sum; drop" } },
    "duplicate params": { function_spec: { ...spec, parameters: [{ name: "a", type: "integer" }, { name: "a", type: "integer" }] } },
    "unknown type": { function_spec: { ...spec, return_type: "map<string>" } },
    "wrong arg count": { test_cases: [{ id: "t1", args: [[1]], expected: 1, visible: true }] },
    "wrong arg type": { test_cases: [{ id: "t1", args: [["x"], 1], expected: 1, visible: true }] },
    "expected wrong type": { test_cases: [{ id: "t1", args: [[1], 1], expected: "2", visible: true }] },
    "integer out of range": { test_cases: [{ id: "t1", args: [[1], 1], expected: 2147483648, visible: true }] },
    "missing expected": { test_cases: [{ id: "t1", args: [[1], 1], visible: true }] },
    "no buggy solution": { buggy_solution: "" },
    "no reference": { reference_solution: " " },
    "too many tests": { test_cases: Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, args: [[i], i], expected: 2 * i })) },
  };
  for (const [name, over] of Object.entries(bad)) {
    assertEquals(parseFunctionFields(reply(over), V), null, name);
  }
});

Deno.test("number returns may use a capped numeric tolerance", () => {
  const a = parseFunctionFields(reply({
    function_spec: { ...spec, return_type: "number" },
    test_cases: [{ id: "t1", args: [[1], 1], expected: 2.5, visible: true, checker: "numeric_tolerance", numeric_tolerance: 5 }],
  }), V);
  assertEquals(a!.test_cases[0].checker, "numeric_tolerance");
  assertEquals(a!.test_cases[0].numeric_tolerance, 0.001);
});

Deno.test("the stored row: stdio exactly as before, function adds kind + spec", () => {
  const stdio = sandboxConfigRow(
    { language: "python", starter_code: "", constraints_text: null, test_cases: [], reference_solution: "print(1)" }, null, 80, "auto");
  assertEquals(Object.keys(stdio).sort(), ["constraints_text", "created_by", "language", "origin", "pass_threshold", "reference_solution", "starter_code", "test_cases"]);
  const fn = sandboxConfigRow({ ...parseFunctionFields(reply(), V)! }, "u1", 100, "resume");
  assertEquals(fn.kind, "function");
  assertEquals((fn.function_spec as { function_name: string }).function_name, "pairSum");
  assertEquals(fn.origin, "resume");
});

const tests = parseFunctionFields(reply(), V)!.test_cases;
const graded = (passed: boolean[]): ProbeGrade => ({
  ok: true, results: tests.map((t, i) => ({ visible: t.visible, passed: passed[i] })),
});

Deno.test("function quality gate: buggy must fail a HIDDEN test, starter must fail, args distinct", async () => {
  // Medium needs 6-8 tests; the 4-test fixture is held to Easy (4-5).
  const good = await checkFunctionTestQuality(tests, "starter", "buggy", "Easy",
    (code) => Promise.resolve(code === "starter" ? graded([false, true, false, false]) : graded([true, true, false, true])));
  assertEquals(good, { ok: true, problems: [] });

  const buggyOnlyFailsVisible = await checkFunctionTestQuality(tests, "starter", "buggy", "Easy",
    (code) => Promise.resolve(code === "starter" ? graded([false, false, false, false]) : graded([false, true, true, true])));
  assert(!buggyOnlyFailsVisible.ok && buggyOnlyFailsVisible.problems.some((p) => p.includes("hidden")), "visible-only catch is too weak");

  const starterPasses = await checkFunctionTestQuality(tests, "starter", "buggy", "Easy",
    (code) => Promise.resolve(code === "starter" ? graded([true, true, true, true]) : graded([true, false, true, true])));
  assert(!starterPasses.ok && starterPasses.problems.some((p) => p.includes("empty/zero")));

  const dup = await checkFunctionTestQuality([...tests.slice(0, 3), { ...tests[3], stdin: tests[2].stdin }], "s", "b", "Easy",
    () => Promise.resolve(graded([false, false, false, false])));
  assert(!dup.ok && dup.problems.some((p) => p.includes("same arguments")));

  const wrongCount = await checkFunctionTestQuality(tests, "s", "b", "Hard", () => Promise.resolve(graded([false, false, false, false])));
  assert(!wrongCount.ok && wrongCount.problems.some((p) => p.includes("Hard")), "difficulty scaling enforced");

  const down = await checkFunctionTestQuality(tests, "s", "b", "Easy", () => Promise.resolve({ ok: false, reason: "runner busy" }));
  assert(!down.ok && down.problems[0].includes("runner busy"), "an unavailable runner is never a pass");
});

import { evaluateFunctionDraft, functionSourceProblem, type DraftGrade } from "./function-generation.ts";

Deno.test("function-only source rules: entry points, packages, input and harness names are refused", () => {
  const bad: [string, string][] = [
    ["python", "def f(a):\n    return int(input())"],
    ["python", "import sys\ndef f(a):\n    return sys.stdin.read()"],
    ["python", "def f(a):\n    return a\nif __name__ == '__main__':\n    print(f(1))"],
    ["javascript", "function f(a){ return require('fs').readFileSync(0,'utf8') }"],
    ["javascript", "process.stdin.on('data', () => {}); function f(a){ return a }"],
    ["ruby", "def f(a)\n  gets.to_i\nend"],
    ["php", "<?php function f($a) { return fgets(STDIN); }"],
    ["java", "class Solution { public int f(int a) { return new java.util.Scanner(System.in).nextInt(); } }"],
    ["java", "class Solution { public static void main(String[] a) {} public int f(int a) { return a; } }"],
    ["java", "package app;\nclass Solution { public int f(int a) { return a; } }"],
    ["java", "class __ProofLabMain {} class Solution { public int f(int a) { return a; } }"],
    ["c", "int f(int a) { int x; scanf(\"%d\", &x); return x; }"],
    ["c", "int f(int a) { return a; }\nint main(void) { return 0; }"],
    ["cpp", "int f(int a) { int x; std::cin >> x; return x; }"],
    ["go", "package main\nfunc f(a int) int { return a }"],
    ["go", "func f(a int) int { return a }\nfunc main() {}"],
    ["go", "func f(a int) int { var x int; fmt.Scan(&x); return x }"],
    ["python", "def f(a):\n    __prooflab_value = a\n    return a"],
    ["c", "int f(int a) { __PLParser p; return a; }"],
    ["python", "def f(a):\n    return a\n" + "#".repeat(20_001)],
  ];
  for (const [language, code] of bad) {
    assert(functionSourceProblem(language, code) !== null, `${language} should be refused: ${code.slice(0, 60)}`);
  }
  const good: [string, string][] = [
    ["python", "def f(a):\n    # read the list, return its sum\n    return sum(a)"],
    ["javascript", "function f(a) { return a.length; }"],
    ["java", "class Solution { public int f(int[] a) { return a.length; } }"],
    ["c", "int f(PLIntArray a) { return (int)a.len; }"],
    ["cpp", "int f(std::vector<int> a) { return (int)a.size(); }"],
    ["go", "func f(a []int) int { return len(a) }"],
    ["ruby", "def f(a)\n  a.sum\nend"],
    ["php", "<?php function f($a) { return count($a); }"],
  ];
  for (const [language, code] of good) assertEquals(functionSourceProblem(language, code), null, language);
});

Deno.test("an AI reply whose reference or buggy brings its own main/input never reaches grading", async () => {
  let graded = 0;
  const v = await evaluateFunctionDraft(
    reply({ reference_solution: "def pairSum(nums, target):\n    return int(input())" }), V,
    () => { graded++; return Promise.resolve({ ok: true, results: [] }); },
    () => Promise.resolve({ ok: true, problems: [] }),
  );
  assert(!v.accepted && graded === 0, "refused before any run");
  const b = await evaluateFunctionDraft(
    reply({
      language: "go",
      reference_solution: "func pairSum(nums []int, target int) int { return target }",
      buggy_solution: "package main\nfunc pairSum(nums []int, target int) int { return 0 }",
    }), V,
    () => { graded++; return Promise.resolve({ ok: true, results: [] }); },
    () => Promise.resolve({ ok: true, problems: [] }),
  );
  assert(!b.accepted && graded === 0);
});

const allPass = (a: { test_cases: { visible: boolean }[] }): DraftGrade =>
  ({ ok: true, passedCount: a.test_cases.length, results: a.test_cases.map((t) => ({ visible: t.visible, passed: true })) });

Deno.test("draft chain: reference must pass 100% - a wrong expected value is rejected with the failing case", async () => {
  const v = await evaluateFunctionDraft(reply(), V,
    (a) => Promise.resolve({
      ok: true,
      results: a.test_cases.map((t, i) => ({ visible: t.visible, passed: i !== 2, stdin: t.stdin, expected: t.expected_output, actual: "5", verdict: i === 2 ? "wrong_answer" : "accepted" })),
    }),
    () => Promise.resolve({ ok: true, problems: [] }));
  assert(!v.accepted, "a failing reference is never accepted");
  assert(!v.accepted && v.retryNote.includes("failed 1 of 4") && v.retryNote.includes("[[-5,5,7],-1]"), "retry names the failing case");
});

Deno.test("draft chain: a short result list or an unavailable runner is never a pass", async () => {
  const short = await evaluateFunctionDraft(reply(), V,
    () => Promise.resolve({ ok: true, results: [{ visible: true, passed: true }] }),
    () => Promise.resolve({ ok: true, problems: [] }));
  assert(!short.accepted);
  const down = await evaluateFunctionDraft(reply(), V,
    () => Promise.resolve({ ok: false, reason: "runner busy" }),
    () => Promise.resolve({ ok: true, problems: [] }));
  assert(!down.accepted && down.retryNote.includes("could not be run"));
});

Deno.test("draft chain: quality problems reject; all green accepts, with the server's starter and ids", async () => {
  const weak = await evaluateFunctionDraft(reply(), V, (a) => Promise.resolve(allPass(a)),
    () => Promise.resolve({ ok: false, problems: ["The deliberately buggy solution passes every hidden test; add hidden tests that catch it."] }));
  assert(!weak.accepted && weak.retryNote.includes("buggy solution passes every hidden test"));
  const good = await evaluateFunctionDraft(reply({ function_spec: { ...spec, class_name: "Injected" } }), V,
    (a) => Promise.resolve(allPass(a)), () => Promise.resolve({ ok: true, problems: [] }));
  assert(good.accepted, "valid draft accepted");
  if (good.accepted) {
    assertEquals(good.attempt.function_spec.class_name, undefined, "AI class name ignored");
    assertEquals(good.attempt.test_cases.map((t) => t.id), ["t1", "t2", "t3", "t4"]);
    assert(good.attempt.starter_code.startsWith("def pairSum("));
  }
});

Deno.test("model test ids are replaced by the server's", () => {
  const a = parseFunctionFields(reply({ test_cases: reply().test_cases.map((t, i) => ({ ...t, id: `<script>${i}` })) }), V);
  assertEquals(a!.test_cases.map((t) => t.id), ["t1", "t2", "t3", "t4"]);
});

Deno.test("function quality gate: more than 2 visible tests is refused; missing taxonomy is refused", async () => {
  const many = tests.map((t) => ({ ...t, visible: true }));
  const r = await checkFunctionTestQuality(many, "s", "b", "Easy", () => Promise.resolve(graded([false, false, false, false])));
  assert(!r.ok && r.problems.some((p) => p.includes("More than 2 visible")));
  const noEdge = tests.map((t) => ({ ...t, kind: t.kind === "edge" ? "normal" as const : t.kind }));
  const e = await checkFunctionTestQuality(noEdge, "s", "b", "Easy", () => Promise.resolve(graded([false, false, false, false])));
  assert(!e.ok && e.problems.some((p) => p.includes("Missing edge")));
  const medium = await checkFunctionTestQuality(tests, "s", "b", "Medium", () => Promise.resolve(graded([false, false, false, false])));
  assert(!medium.ok && medium.problems.some((p) => p.includes("Medium coding tasks require 6-8")));
});

Deno.test("S36: a rejected draft says why in the log line, with counts only and nothing from a test", async () => {
  // What the broken Java harness looked like: the first run does not compile, the rest are not run.
  const v = await evaluateFunctionDraft(reply(), V,
    (a) => Promise.resolve({
      ok: true,
      results: a.test_cases.map((t) => ({ visible: t.visible, passed: false, stdin: t.stdin, expected: t.expected_output, actual: "", verdict: "compile_error" })),
    }),
    () => Promise.resolve({ ok: true, problems: [] }));
  assert(!v.accepted, "rejected");
  if (v.accepted) return;
  assertEquals(v.reason, "reference failed 4 of 4 tests (compile_error x4), language python");
  assert(!/[\[\]=]/.test(v.reason), "no arguments or expected values in the reason");

  const contract = await evaluateFunctionDraft({ language: "cobol" }, V,
    () => Promise.resolve({ ok: true, results: [] }), () => Promise.resolve({ ok: true, problems: [] }));
  assert(!contract.accepted && contract.reason === "reply did not match the function contract");

  const down = await evaluateFunctionDraft(reply(), V,
    () => Promise.resolve({ ok: false }), () => Promise.resolve({ ok: true, problems: [] }));
  assert(!down.accepted && down.reason === "reference could not be run by the grader");

  const weak = await evaluateFunctionDraft(reply(), V, (a) => Promise.resolve(allPass(a)),
    () => Promise.resolve({ ok: false, problems: ["a constant answer passes", "secret detail"] }));
  assert(!weak.accepted && weak.reason === "tests too weak (2 problems)", "the problems themselves stay out of the log");

  // An odd verdict string from a runner can never smuggle text into the log.
  const odd = await evaluateFunctionDraft(reply(), V,
    (a) => Promise.resolve({ ok: true, results: a.test_cases.map((t) => ({ visible: t.visible, passed: false, verdict: "x\ninjected line [[1,2],3]" })) }),
    () => Promise.resolve({ ok: true, problems: [] }));
  assert(!odd.accepted && odd.reason.includes("failed x4") && !odd.reason.includes("injected"));
});
