// Run: node --experimental-strip-types --test src/lib/lotSections.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLotSections } from "./lotSections.ts";

test("a contract Lot splits into labelled sections, context first", () => {
  const s = splitLotSections(
    "A shop counts products.\nIt has many names.\nYour task: count distinct names.\nInput: one line.\nOutput: one integer.\nExample: Pen pen Book -> 2\nWhy: pen repeats.",
  );
  assert.deepEqual(s?.map((x) => x.label), ["Context", "Your task", "Input", "Output", "Example", "Why"]);
  assert.equal(s?.[0].text, "A shop counts products.\nIt has many names.");
  assert.equal(s?.[2].text, "one line.");
});

test("multi-line examples stay with their label; bold labels are accepted", () => {
  const s = splitLotSections("Ctx.\n**Your task:** do it\nExample:\n3\n1 2 3\nWhy: sums");
  assert.equal(s?.find((x) => x.label === "Example")?.text, "3\n1 2 3");
  assert.equal(s?.find((x) => x.label === "Your task")?.text, "do it");
});

test("an old unlabelled Lot returns null so the old view is kept", () => {
  assert.equal(splitLotSections("Fix the bug in the function. Submit your code."), null);
  assert.equal(splitLotSections("Your task: only one label here."), null);
});
