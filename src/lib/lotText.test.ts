import assert from "node:assert/strict";
import test from "node:test";
import { dropHelper, lotStatusText, oneRange, part10, squadUpdateText, triesSummary, voiceOwedText } from "./lotText.ts";

test("one word range: the checker's replaces the one in the text", () => {
  const w = { min: 150, max: 800 };
  assert.equal(oneRange("Write 150-250 words in the box.", w), "Write 150–800 words in the box.");
  assert.equal(oneRange("about 100 to 200 words", w), "about 150–800 words");
  assert.equal(oneRange("What to write: 300–500 words.", w), "What to write: 150–800 words.");
  assert.equal(oneRange("Write 150-250 words.", null), "Write 150-250 words.");
  assert.equal(oneRange("List 3 risks in 2024.", w), "List 3 risks in 2024.");
});

test("the explainer's own rule is dropped", () => {
  assert.equal(dropHelper("A sheet has mistakes. You are not solving the task now; you are just making the question clear. Find them."),
    "A sheet has mistakes. Find them.");
  assert.equal(dropHelper("Fix the sheet."), "Fix the sheet.");
});

test("one Lot status everywhere", () => {
  assert.equal(lotStatusText({ passed: false, submitted: true, mark10: 6.5 }), "Submitted, not passed (6.5/10)");
  assert.equal(lotStatusText({ passed: false, submitted: false, mark10: 6 }), "Not passed yet (6/10)");
  assert.equal(lotStatusText({ passed: true, submitted: true, mark10: 8 }), "Passed");
});

test("rubric parts read out of 10", () => {
  assert.equal(part10(25, 25), "10/10");
  assert.equal(part10(0, 25), "0/10");
  assert.equal(part10(15, 30), "5/10");
});

test("Progress tiles: tries, Lots, passed and not passed in one line", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({ task_id: `t${i}`, status: "passed" })),
    { task_id: "t0", status: "failed" }, { task_id: "t8", status: "failed" }, { task_id: "t8", status: "failed" },
  ];
  const s = triesSummary(rows);
  assert.equal(s.text, "11 tries on 9 Lots (8 passed, 3 not passed)");
  assert.equal(triesSummary([]).text, "0 tries on 0 Lots (0 passed, 0 not passed)");
});

test("voice owed reads one way everywhere (QA round 2 item 21)", () => {
  assert.equal(voiceOwedText({ coding: true, passed: true, dueToday: true }),
    "Code passed - record your 60s explanation to finish (due today)");
  assert.equal(voiceOwedText({ coding: false, passed: false, mark10: 6.5, dueToday: false }),
    "Submitted, not passed (6.5/10) - record your 60s explanation to finish");
});

test("squad card says when points update (item 25)", () => {
  assert.match(squadUpdateText("2026-11-12T00:00:00Z", () => "Thu 12 Nov"), /once a week.*Next update: Thu 12 Nov, about 5:40 AM/);
  assert.doesNotMatch(squadUpdateText(null, () => "x"), /Next update/);
});
