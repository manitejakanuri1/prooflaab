import test from "node:test";
import assert from "node:assert/strict";
import { bestSaved, savedResultLine } from "./savedAnswer.ts";

const t = (h: number) => `2026-10-30T0${h}:00:00Z`;
test("finished task: the passed answer is the one shown, else the best, newest on a tie (MF-020)", () => {
  const rows = [
    { code: "first", passed_count: 2, total_count: 5, sandbox_score: 40, status: "failed", created_at: t(1) },
    { code: "pass", passed_count: 5, total_count: 5, sandbox_score: 100, status: "passed", created_at: t(2) },
    { code: "later", passed_count: 3, total_count: 5, sandbox_score: 60, status: "failed", created_at: t(3) },
  ];
  assert.equal(bestSaved(rows)?.code, "pass");
  assert.equal(bestSaved([rows[0], rows[2]])?.code, "later");
  assert.equal(bestSaved([])?.code, undefined);
});
test("finished task: the result line shows tests or score, and the voice score", () => {
  const coding = { code: "x", passed_count: 4, total_count: 5, sandbox_score: 80, status: "failed", created_at: t(1) };
  assert.equal(savedResultLine(coding, "coding", 70), "Your saved answer · 4 of 5 tests passed · Voice 7 / 10");
  assert.equal(savedResultLine({ ...coding, total_count: 0 }, "written", null), "Your saved answer · Score 80 of 100");
});
