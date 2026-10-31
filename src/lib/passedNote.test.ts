import assert from "node:assert/strict";
import test from "node:test";
import { passedNote } from "./passedNote.ts";

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
