import {
  chooseSandboxKind,
  explicitCodingProblem,
  normalizeDifficulty,
  resolveDifficulty,
  rubricFallbackAllowed,
  TEST_COUNT_RANGE,
} from "./coding-mode.ts";

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

Deno.test("function mode is chosen only for clearly function-style tasks", () => {
  assertEquals(chooseSandboxKind("Two sum", "Implement a function twoSum(nums, target) that returns the two indices."), "function");
  assertEquals(chooseSandboxKind("Palindrome", "Write a function that returns true if the string reads the same both ways."), "function");
  assertEquals(chooseSandboxKind("Reverse", "Complete the method reverseWords so it returns the words in reverse order."), "function");
  assertEquals(chooseSandboxKind("Max", "maxOf(a, b) returns the larger of two integers."), "function");
});

Deno.test("whole-program and unclear tasks stay stdio (the old behaviour)", () => {
  assertEquals(chooseSandboxKind("Sum", "Read N numbers from standard input and print their sum."), "stdio");
  assertEquals(chooseSandboxKind("Grades", "Read a mark and print its letter grade."), "stdio");
  assertEquals(chooseSandboxKind("Log counter", "Count failed logins per user."), "stdio");
  // Any mention of input/printing wins over function wording.
  assertEquals(chooseSandboxKind("Mixed", "Write a function solve(n) and print its result to stdout."), "stdio");
});

Deno.test("difficulty: explicit wins, then the reply, then Medium", () => {
  assertEquals(resolveDifficulty("Hard", { difficulty: "Easy" }), "Hard");
  assertEquals(resolveDifficulty(undefined, { difficulty: "easy" }), "Easy");
  assertEquals(resolveDifficulty(null, { difficulty: "impossible" }), "Medium");
  assertEquals(resolveDifficulty(undefined, {}), "Medium");
  assertEquals(resolveDifficulty(undefined, null), "Medium");
  assertEquals(normalizeDifficulty(" MEDIUM "), "Medium");
  assertEquals(normalizeDifficulty("expert"), null);
  assertEquals(TEST_COUNT_RANGE.Easy, [4, 5]);
  assertEquals(TEST_COUNT_RANGE.Medium, [6, 8]);
  assertEquals(TEST_COUNT_RANGE.Hard, [8, 10]);
});

Deno.test("an explicit coding request never falls back to a written task", () => {
  assertEquals(rubricFallbackAllowed(true), false);
  const failed = { ok: false, mode: "sandbox", configId: null };
  const downgraded = { ok: true, mode: "rubric", configId: "r1" };
  const noConfig = { ok: true, mode: "sandbox", configId: null };
  for (const r of [failed, downgraded, noConfig]) {
    assertEquals(typeof explicitCodingProblem(true, r), "string");
  }
  assertEquals(explicitCodingProblem(true, { ok: true, mode: "sandbox", configId: "s1" }), null);
});

Deno.test("an auto-guessed mode keeps its (logged) written fallback", () => {
  assertEquals(rubricFallbackAllowed(false), true);
  assertEquals(explicitCodingProblem(false, { ok: true, mode: "rubric", configId: "r1" }), null);
});
