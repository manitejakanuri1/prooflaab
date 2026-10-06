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
