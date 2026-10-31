import test from "node:test";
import assert from "node:assert/strict";
import { matchScore, matchStatus } from "./matchStatus.ts";

test("a scheduled 0-0 and a played 0-0 no longer look the same", () => {
  const scheduled = { status: "scheduled", home_points: 0, away_points: 0 };
  assert.equal(matchStatus(scheduled), "Scheduled");
  assert.equal(matchScore(scheduled), "–");
  assert.equal(matchStatus({ status: "played", decided_by: "draw", home_points: 4, away_points: 4 }), "Played");
  assert.equal(matchScore({ status: "played", home_points: 21, away_points: 0 }), "21–0");
});
test("no activity shows no score; a seed decision shows the drawn score", () => {
  assert.equal(matchStatus({ status: "no_activity", decided_by: "no_activity", home_points: 0, away_points: 0 }), "No activity");
  assert.equal(matchScore({ status: "no_activity", decided_by: "no_activity", home_points: 0, away_points: 0 }), "–");
  const seed = { status: "no_activity", decided_by: "higher_seed", home_points: 0, away_points: 0 };
  assert.equal(matchStatus(seed), "Decided on seed");
  assert.equal(matchScore(seed), "0–0");
});
