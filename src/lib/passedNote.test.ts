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
  assert.match(n, /did not match the work you submitted \(3\/100\)/);
  assert.match(n, /scored 5\/100/);
  assert.match(n, /full 60 seconds/);
});

test("only the low one is mentioned", () => {
  const n = passedNote(90, 20)!;
  assert.match(n, /20\/100/);
  assert.doesNotMatch(n, /spoken explanation scored/);
});

test("green Passed only with voice 50+; missing voice is not 50+ (owner 1 Nov 2026)", () => {
  assert.equal(passedLabel("code", 50), "Passed");
  assert.equal(passedLabel("code", 49), "Code passed · voice needs redo");
  assert.equal(passedLabel("written", null), "Answer passed · voice needs redo");
  assert.equal(passedLabel("code", undefined), "Code passed · voice needs redo");
});
