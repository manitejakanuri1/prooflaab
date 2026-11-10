import assert from "node:assert/strict";
import test from "node:test";
import { passedLabel, passedNote } from "./passedNote.ts";

test("no note when both scores are fine or missing", () => {
  assert.equal(passedNote(80, 70), null);
  assert.equal(passedNote(null, undefined), null);
  assert.equal(passedNote(50, 50), null);
});

test("names each low score and how to improve (QA case: voice 5, match 3)", () => {
  const n = passedNote(5, 3)!;
  assert.match(n, /^Your work passed/);
  assert.match(n, /Talk check: not matched/);
  assert.match(n, /scored 0\.5\/10/);
  assert.match(n, /what you tried and changed/);
  assert.doesNotMatch(n, /\/100/);
});

test("only the low one is mentioned", () => {
  const n = passedNote(90, 20)!;
  assert.match(n, /Talk check: not matched/);
  assert.doesNotMatch(n, /voice scored/);
});

test("green Passed only with voice 50+; missing voice is not 50+ (owner 1 Nov 2026)", () => {
  assert.equal(passedLabel("code", 50), "Passed");
  assert.equal(passedLabel("code", 49), "Code passed · low voice score");
  assert.equal(passedLabel("written", null), "Answer passed · no voice score");
  assert.equal(passedLabel("code", undefined), "Code passed · no voice score");
});
