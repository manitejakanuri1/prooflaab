import test from "node:test";
import assert from "node:assert/strict";
import { checkLine, fmtMark, of10, scoreText10, talkCheck, voiceLine } from "./lotMarksText.ts";

test("marks: whole marks show no decimal, others one", () => {
  assert.equal(fmtMark(8), "8");
  assert.equal(fmtMark(7.1), "7.1");
  assert.equal(fmtMark(null), "–");
  assert.equal(fmtMark(0), "0");
  assert.equal(of10(72), "7.2/10");
  assert.equal(of10(100), "10/10");
  assert.equal(of10(null), "–");
  assert.equal(scoreText10("readiness 46/100"), "readiness 4.6/10");
  assert.equal(scoreText10("resume score 61 · ATS 56"), "resume score 6.1/10 · ATS 5.6/10");
  assert.equal(talkCheck(88), "Matched");
  assert.equal(talkCheck(30), "Partly");
  assert.equal(talkCheck(29), "Not matched");
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
