import test from "node:test";
import assert from "node:assert/strict";
import { checkLine, fmtMark, voiceLine } from "./lotMarksText.ts";

test("marks: whole marks show no decimal, others one", () => {
  assert.equal(fmtMark(8), "8");
  assert.equal(fmtMark(7.1), "7.1");
  assert.equal(fmtMark(null), "0");
});
test("check line: submit or try again while checks are left, then the best mark", () => {
  assert.match(checkLine(8, { daily: true, checks_left: 2, submitted: false }), /2 tries left/);
  assert.match(checkLine(9, { daily: true, checks_left: 1, submitted: false }), /1 try left/);
  assert.equal(checkLine(7, { daily: true, checks_left: 0, submitted: true, best_mark: 9 }), "Your best was 9 - that is your score.");
});
test("voice line: last try, closed, scored, not a Daily Lot", () => {
  assert.match(voiceLine({ daily: true, voice_state: "open", voice_tries_left: 1 }) ?? "", /last try/);
  assert.match(voiceLine({ daily: true, voice_state: "tried", voice_closed: true }) ?? "", /closed/);
  assert.match(voiceLine({ daily: true, voice_state: "scored", voice_mark: 6.5 }) ?? "", /6\.5/);
  assert.equal(voiceLine({ daily: false }), null);
});
test("week 2 on (strict): coding asks to fix and check again; written shows the one score", () => {
  assert.match(checkLine(9, { daily: true, mode: "strict", kind: "coding", submitted: false, checks_left: null }), /every test passes/);
  assert.equal(checkLine(6.5, { daily: true, mode: "strict", kind: "written", submitted: true, checks_left: 0, best_mark: 6.5 }),
    "Your score is 6.5 out of 10.");
});
