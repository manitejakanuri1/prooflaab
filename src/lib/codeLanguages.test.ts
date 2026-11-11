import assert from "node:assert/strict";
import test from "node:test";
import { anyLanguageText, languageLabel, STARTERS } from "./codeLanguages.ts";

test("task text names no language on a Lot open to any language", () => {
  assert.equal(anyLanguageText("Your task: Write a JavaScript function that takes an array."),
    "Your task: Write your code that takes an array.");
  assert.equal(anyLanguageText("Write a C++ program and a Python script."), "Write your code and your code.");
  assert.equal(anyLanguageText("A small JavaScript utility for a cart."), "A small JavaScript utility for a cart.");
});

test("five starters, each reads stdin; labels", () => {
  assert.deepEqual(Object.keys(STARTERS).sort(), ["c", "cpp", "java", "javascript", "python"]);
  for (const s of Object.values(STARTERS)) assert.match(s, /stdin|System\.in|cin|readFileSync\(0/);
  assert.equal(languageLabel("cpp"), "C++");
  assert.equal(languageLabel("go"), "go");
});
