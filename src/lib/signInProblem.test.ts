import assert from "node:assert/strict";
import test from "node:test";
import { signInProblem } from "./signInProblem.ts";

test("each sign-in problem gets its own plain sentence, with no banned words", () => {
  const cases: [unknown, RegExp][] = [
    [new Error("Invalid login credentials"), /do not match/],
    [{ message: "Email not confirmed" }, /Confirm your email/],
    [new Error("Too many attempts. Please wait and try again"), /Wait a few minutes/],
    [new Error("Too many tries. Wait a few minutes, then try again."), /Wait a few minutes/],
    [new TypeError("Failed to fetch"), /No connection/],
    [new Error("This account has been turned off"), /turned off/],
    [null, /did not go through/],
  ];
  for (const [error, want] of cases) {
    const text = signInProblem(error);
    assert.match(text, want);
    assert.doesNotMatch(text, /\b(failed|wrong|invalid|unfortunately)\b/i);
  }
});
