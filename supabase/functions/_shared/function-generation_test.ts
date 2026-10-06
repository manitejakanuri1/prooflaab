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
