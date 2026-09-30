// Written-task scratchpad (migration 48): which tasks get one, and what Submit sends.
// Run: node --test src/lib/scratchpad.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCRATCH_LANGUAGES, scratchLabel, scratchLanguage, writtenSubmitBody } from "./scratchpad.ts";

test("NULL / missing scratch_language: no scratchpad", () => {
  assert.equal(scratchLanguage(null), null);
  assert.equal(scratchLanguage(undefined), null);
  // A business / HR / pitch task's view never carries a language.
  const businessView = { task_id: "t", title: "Pitch", prompt_text: "Sell it", scratch_language: null };
  assert.equal(scratchLanguage(businessView.scratch_language), null);
});

test("python and java: labelled scratchpads", () => {
  assert.equal(scratchLanguage("python"), "python");
  assert.equal(scratchLabel("python") + " Scratchpad", "Python Scratchpad");
  assert.equal(scratchLanguage("java"), "java");
  assert.equal(scratchLabel("java") + " Scratchpad", "Java Scratchpad");
  assert.equal(scratchLabel("cpp") + " Scratchpad", "C++ Scratchpad");
});

test("anything outside the runner's 8 languages shows no scratchpad", () => {
  for (const bad of ["cobol", "Python", " python", "", "sql", 1, {}, ["python"]]) {
    assert.equal(scratchLanguage(bad), null, JSON.stringify(bad));
  }
});

test("the allowed list is exactly the code runner's languages (same as the DB CHECK)", () => {
  assert.deepEqual([...SCRATCH_LANGUAGES].sort(), ["c", "cpp", "go", "java", "javascript", "php", "python", "ruby"]);
});

test("Submit sends only the task id and the written answer", () => {
  const body = writtenSubmitBody("task-1", "My written answer");
  assert.deepEqual(body, { task_id: "task-1", answer: "My written answer" });
  assert.deepEqual(Object.keys(body).sort(), ["answer", "task_id"]);
});
