// Coding verdict names on student screens, including B2-A's output_limit.
// Run: node --experimental-strip-types --test src/lib/codingVerdicts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { VERDICT_LABEL, VERDICT_TEXT, verdictLabel, verdictText } from "./codingVerdicts.ts";
import { hiddenSummaryText, isHiddenSummary, safeResultRows } from "./functionSignature.ts";

test("output_limit is named on both screens", () => {
  assert.equal(verdictText("output_limit"), "Too much output");
  assert.deepEqual(verdictLabel("output_limit"), {
    title: "Too much output",
    hint: "Your code printed too much. Remove extra print statements and just return the answer.",
  });
});

test("existing verdict names are unchanged", () => {
  assert.deepEqual(VERDICT_TEXT, {
    accepted: "Passed",
    wrong_answer: "Wrong answer",
    runtime_error: "Crashed",
    compile_error: "Did not compile",
    time_limit: "Too slow",
    output_limit: "Too much output",
  });
  assert.deepEqual(VERDICT_LABEL.accepted, { title: "Passed", hint: "" });
  assert.deepEqual(VERDICT_LABEL.wrong_answer, { title: "Wrong answer", hint: "It ran fine — the logic is off." });
  assert.deepEqual(VERDICT_LABEL.runtime_error, { title: "Crashed", hint: "It started, then threw. The error is below." });
  assert.deepEqual(VERDICT_LABEL.compile_error, { title: "Won't build", hint: "A syntax problem — nothing ran yet." });
  assert.deepEqual(VERDICT_LABEL.time_limit, { title: "Too slow", hint: "It may be correct, but it took too long." });
});

test("an unknown future verdict never crashes: label.title / label.hint always exist", () => {
  const label = verdictLabel("memory_limit");
  assert.equal(label.title, "Failed");
  assert.equal(label.hint, "");
  assert.equal(verdictText("memory_limit"), "Failed");
});

test("a results list with output_limit and a hidden summary renders as before", () => {
  const rows = safeResultRows([
    { id: "t1", visible: true, verdict: "output_limit", passed: false, stdin: "[1]", expected: "1", actual: "" },
    { id: "hidden-summary", visible: false, verdict: "hidden", passed: false, hidden_count: 3, hidden_passed: 1, hidden_failed: 2 },
  ]);
  assert.equal(rows.length, 2);
  const [first, second] = rows;
  assert.equal(isHiddenSummary(first), false);
  assert.equal(verdictLabel((first as { verdict: string }).verdict).title, "Too much output");
  assert.ok(isHiddenSummary(second));
  if (isHiddenSummary(second)) assert.equal(hiddenSummaryText(second), "1 of 3 hidden tests passed");
});
