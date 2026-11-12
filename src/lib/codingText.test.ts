import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeCoding } from "./codingText.ts";

test("a written teamwork question is not a coding task", () => {
  assert.equal(looksLikeCoding("Teamwork reflection. In 3-4 sentences, describe a time you worked in a team and what you learned."), false);
});

test("a real coding task is", () => {
  assert.equal(looksLikeCoding("Write a Python function that reverses a string. Input: one line. Output: the reversed line."), true);
  assert.equal(looksLikeCoding("Write a SQL query that lists customers with no orders."), true);
});
