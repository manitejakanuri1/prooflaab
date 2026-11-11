import assert from "node:assert/strict";
import test from "node:test";
import { dropHelper, dropWordRange, lotStatusText, oneRange, part10, squadUpdateText, triesSummary, voiceOwedText, weekDayText, weekLotsText } from "./lotText.ts";

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
  assert.match(squadUpdateText("2026-11-12T00:00:00Z", () => "Thu 12 Nov", new Date("2026-11-11T09:00:00Z")), /once a week.*Next update: about Thu 12 Nov/);
  // F3: Wednesday afternoon, the week ended Wednesday morning: the next update is the Wednesday after.
  assert.match(squadUpdateText("2026-11-11T00:00:00Z", (d) => d.toISOString().slice(0, 10), new Date("2026-11-11T09:00:00Z")), /Next update: about 2026-11-18/);
  assert.doesNotMatch(squadUpdateText(null, () => "x"), /Next update/);
});

test("F2: a Lot with its voice owed is named, not counted as finished", () => {
  const done = { coding_mark: 10, voice_mark: 7.2, voice_state: "scored", day_total: 17.2 };
  const owed = { coding_mark: 5.5, voice_mark: 0, voice_state: "open", day_total: 0 };
  assert.equal(weekLotsText([done, owed]), "1 finished, 1 voice owed");
  assert.equal(weekLotsText([done]), "1 Lot");
  assert.equal(weekDayText(owed), "5.5 + voice owed = 0 (counts when your voice is scored)");
  assert.equal(weekDayText(done), "10 + 7.2 = 17.2");
});

test("Lot simplify: the word range is said once, on the marking line", () => {
  assert.equal(dropWordRange("Write your answer in 100–200 words."), "");
  assert.equal(dropWordRange("You have written a short 100–200 words explanation covering all four points."),
    "You have written a short explanation covering all four points.");
  assert.equal(dropWordRange("Say what a LEFT JOIN does."), "Say what a LEFT JOIN does.");
});
