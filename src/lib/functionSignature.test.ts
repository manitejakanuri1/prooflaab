// Function-mode display: named arguments, return values, the hidden-test summary,
// and stdio views left alone.
// Run: node --experimental-strip-types --test src/lib/functionSignature.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatArguments,
  formatReturn,
  formatValue,
  functionSpecOf,
  hiddenSummaryText,
  isHiddenSummary,
  safeResultRows,
  signatureLine,
  type FunctionSpecView,
} from "./functionSignature.ts";

const spec: FunctionSpecView = {
  function_name: "pairSum",
  parameters: [{ name: "nums", type: "array<integer>" }, { name: "k", type: "integer" }],
  return_type: "array<string>",
};

test("arguments are shown by parameter name", () => {
  assert.equal(formatArguments("[[1,2],3]", spec), "nums = [1, 2], k = 3");
  assert.equal(formatArguments("[[],-0.5]", { ...spec, parameters: [{ name: "xs", type: "array<number>" }, { name: "t", type: "number" }] }), "xs = [], t = -0.5");
  assert.equal(formatArguments("[]", { ...spec, parameters: [] }), "(no arguments)");
  assert.equal(formatArguments('["a\\"b\\nc"]', { ...spec, parameters: [{ name: "s", type: "string" }] }), 's = "a\\"b\\nc"');
});

test("malformed or mismatched arguments fall back to the raw text", () => {
  assert.equal(formatArguments("not json", spec), "not json");
  assert.equal(formatArguments("[1]", spec), "[1]");
});

test("return values are readable", () => {
  assert.equal(formatReturn('["x","y"]'), '["x", "y"]');
  assert.equal(formatReturn("true"), "true");
  assert.equal(formatReturn("oops"), "oops");
  assert.equal(formatValue([[1, 2], [3]]), "[[1, 2], [3]]");
});

test("signature in the task's language", () => {
  assert.equal(signatureLine("java", spec), "public String[] pairSum(int[] nums, int k)");
  assert.equal(signatureLine("go", spec), "func pairSum(nums []int, k int) []string");
});

test("stdio views (no kind, stdio, or a broken spec) get no function display", () => {
  assert.equal(functionSpecOf({}), null);
  assert.equal(functionSpecOf({ kind: "stdio", function_spec: spec }), null);
  assert.equal(functionSpecOf({ kind: "function", function_spec: null }), null);
  assert.equal(functionSpecOf({ kind: "function", function_spec: { function_name: "f" } }), null);
  assert.deepEqual(functionSpecOf({ kind: "function", function_spec: spec }), spec);
});

test("hidden tests arrive as one summary with counts only", () => {
  const s = { id: "hidden-summary", visible: false, verdict: "hidden", passed: false, hidden_count: 4, hidden_passed: 3, hidden_failed: 1 } as const;
  assert.equal(isHiddenSummary(s), true);
  assert.equal(hiddenSummaryText(s), "3 of 4 hidden tests passed");
  assert.equal(hiddenSummaryText({ ...s, hidden_count: 1, hidden_passed: 1, hidden_failed: 0 }), "1 of 1 hidden test passed");
  // A visible per-test result is not a summary.
  assert.equal(isHiddenSummary({ id: "t1", visible: true, verdict: "accepted", passed: true }), false);
  assert.equal(isHiddenSummary(null), false);
});

const SECRET = "SECRET-HIDDEN-VALUE";

test("results: visible rows kept, the server's hidden summary kept as one count row", () => {
  const rows = safeResultRows([
    { id: "t1", visible: true, verdict: "wrong_answer", passed: false, stdin: "[1]", expected: "2", actual: "3", stderr: "" },
    { id: "hidden-summary", visible: false, verdict: "hidden", passed: false, hidden_count: 3, hidden_passed: 2, hidden_failed: 1 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "t1");
  assert.deepEqual(rows[1], { id: "hidden-summary", visible: false, verdict: "hidden", passed: false, hidden_count: 3, hidden_passed: 2, hidden_failed: 1 });
});

test("results: per-test hidden rows (older server) are collapsed - no hidden stdin, output, error, id or verdict survives", () => {
  const rows = safeResultRows([
    { id: "t1", visible: true, verdict: "accepted", passed: true, stdin: "[1]", expected: "1", actual: "1" },
    { id: "SECRET-ID-1", visible: false, verdict: "wrong_answer", passed: false, stdin: SECRET, expected: SECRET, actual: SECRET, stderr: SECRET },
    { id: "SECRET-ID-2", visible: false, verdict: "accepted", passed: true, stdin: SECRET, expected: SECRET, actual: SECRET },
  ]);
  const text = JSON.stringify(rows);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes("SECRET-ID"), false);
  assert.equal(text.includes("wrong_answer"), false);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { id: "hidden-summary", visible: false, verdict: "hidden", passed: false, hidden_count: 2, hidden_passed: 1, hidden_failed: 1 });
});

test("results: extra fields on a server summary are dropped; counts are recomputed consistently", () => {
  const rows = safeResultRows([
    { id: "hidden-summary", visible: false, verdict: "hidden", passed: true, hidden_count: 2, hidden_passed: 2, hidden_failed: 0, stdin: SECRET } as never,
  ]);
  assert.equal(JSON.stringify(rows).includes(SECRET), false);
});

test("results: stdio rows without a visible flag (old run results) still show; no hidden rows -> no summary", () => {
  const rows = safeResultRows([{ stdin: "1 2", expected: "3", actual: "3", stderr: "", passed: true }]);
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { stdin: string }).stdin, "1 2");
  assert.deepEqual(safeResultRows(null), []);
});
