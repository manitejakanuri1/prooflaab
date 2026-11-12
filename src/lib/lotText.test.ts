import assert from "node:assert/strict";
import test from "node:test";
import { lotLine, pickVoice, lotRowText, copiedNoteText, dropHelper, dropWordRange, plainCode, tidyShown, lotStatusText, oneRange, part10, squadUpdateText, triesSummary, voiceOwedText, weekDayText, weekLotsText } from "./lotText.ts";

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
  assert.equal(lotStatusText({ passed: false, submitted: true, mark10: 6.5 }), "Not passed · 6.5/10");
  assert.equal(lotStatusText({ passed: false, submitted: false, mark10: 6 }), "Not passed · 6/10");
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
    "Passed · voice not done - record your 60s explanation to finish (due today)");
  assert.equal(voiceOwedText({ coding: false, passed: false, mark10: 6.5, dueToday: false }),
    "Not passed · 6.5/10 · voice not done - record your 60s explanation to finish");
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
  // Owner 12 Nov 2026: "of N to M words" must not leave a stray "of".
  assert.equal(dropWordRange("You have typed a spoken-style self introduction of 150 to 250 words that covers your background."),
    "You have typed a spoken-style self introduction that covers your background.");
  assert.equal(dropWordRange("You have written a short 100–200 words explanation covering all four points."),
    "You have written a short explanation covering all four points.");
  assert.equal(dropWordRange("Say what a LEFT JOIN does."), "Say what a LEFT JOIN does.");
});

test("plainCode turns codes into words", () => {
  assert.equal(plainCode("needs_review"), "Waiting for a person");
  assert.equal(plainCode("off_topic"), "Off topic");
  assert.equal(plainCode("some_new_code"), "Some new code");
});

test("tidyShown: plain quotes, and text about the student reads as talking to them", () => {
  assert.equal(tidyShown('Say \\"hi\\".'), 'Say "hi".');
  assert.equal(tidyShown("The student must explain the query. Then the student has to say why."),
    "You must explain the query. Then you have to say why.");
});

test("copied-answer note names both students with their squads", () => {
  const n = { submission_id: "s", created_at: "2026-11-12T05:00:00Z", task_title: "Craft a 60-second self introduction", lot_date: "2026-11-12",
    student_name: "Meghana Reddy", student_squad: "CSE-A Titans", other_name: "Ravi Kumar", other_squad: null };
  assert.equal(copiedNoteText(n, (d) => d.slice(0, 10)),
    "Looks copied: Meghana Reddy (CSE-A Titans) and Ravi Kumar wrote almost the same answer on Craft a 60-second self introduction, 2026-11-12.");
  assert.equal(copiedNoteText({ ...n, other_name: null }, (d) => d.slice(0, 10)).startsWith("Looks copied: Meghana Reddy (CSE-A Titans) wrote almost"), true);
  // P5: the submission day, not the Lot's day (they can differ).
  assert.equal(copiedNoteText({ ...n, lot_date: "2026-11-02", created_at: "2026-11-01T08:08:28Z" }, (d) => d.slice(0, 10)).endsWith(", 2026-11-01."), true);
});

test("done-when: 'and your answer is N to M words' goes with its range (overnight TEST item 9)", () => {
  assert.equal(dropWordRange("You have written 4 to 6 questions with a short reason for each, grouped by topic, and your answer is 150 to 300 words without asking about salary or leave."),
    "You have written 4 to 6 questions with a short reason for each, grouped by topic without asking about salary or leave.");
});

test("college drawer: a Lot's state uses the same words as the header and the student", () => {
  assert.equal(lotRowText("passed", "completed"), "Passed");
  assert.equal(lotRowText("passed", "pending_voice"), "Passed · voice not done");
  assert.equal(lotRowText("failed", "pending"), "Not passed");
  assert.equal(lotRowText("needs_review"), "Waiting for a person");
});

test("Y1/Y2: one status line for a Lot on every screen", () => {
  assert.equal(lotLine({ answer: "failed", mark10: 1.9, voice: null }), "Not passed · 1.9/10 · voice not done");
  assert.equal(lotLine({ answer: "passed", mark10: 10, voice: "failed", reason: "off_topic" }), "Passed · 10/10 · voice not accepted - off topic");
  assert.equal(lotLine({ answer: "returned", mark10: 10, company: "Acme" }), "Returned by Acme for changes · 10/10");
  assert.equal(lotLine({ answer: "returned" }), "Returned by the company for changes");
  assert.equal(lotLine({ answer: "passed", mark10: 10, voice: "scored", voiceScore: 72 }), "Passed · 10/10 · voice done");
  assert.equal(lotLine({ answer: "passed", voice: "scored", voiceScore: 30 }), "Passed · low voice score");
  assert.equal(lotLine({ answer: "passed", voice: "processing" }), "Passed · voice being checked");
  assert.equal(lotLine({ answer: "failed", mark10: 1.9 }), "Not passed · 1.9/10");
  assert.equal(lotLine({ answer: "needs_review" }), "Waiting for a person");
  const v = (status: string, created_at: string, withdrawn_at: string | null = null) => ({ status, created_at, withdrawn_at });
  assert.equal(pickVoice([v("failed", "2026-11-02"), v("scored", "2026-11-01")])?.status, "scored");
  assert.equal(pickVoice([v("failed", "2026-11-01"), v("processing", "2026-11-02")])?.status, "processing");
  assert.equal(pickVoice([v("scored", "2026-11-01", "2026-11-03")]), null);
});
