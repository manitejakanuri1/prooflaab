import assert from "node:assert/strict";
import test from "node:test";
import { rankText, showNextMatch } from "./rankText.ts";

test("company candidate: rank 0 or missing reads Not ranked yet", () => {
  assert.equal(rankText(0), "Not ranked yet");
  assert.equal(rankText(null), "Not ranked yet");
  assert.equal(rankText(0, 11), "Not ranked yet");
  assert.equal(rankText(3), "#3");
  assert.equal(rankText(3, 11), "3/11");
});

test("squad: a rest week never shows a next match, so never '? vs ?'", () => {
  const next = { home_squad: "a", away_squad: "b" };
  assert.equal(showNextMatch(next, true), false);
  assert.equal(showNextMatch(null, false), false);
  assert.equal(showNextMatch(next, false), true);
});
