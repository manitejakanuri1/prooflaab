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
  assert.equal(matchStatus({ status: "no_activity", decided_by: "no_activity", home_points: 0, away_points: 0 }), "Scored: no activity from either squad (0-0)");
  assert.equal(matchScore({ status: "no_activity", decided_by: "no_activity", home_points: 0, away_points: 0 }), "–");
  const seed = { status: "no_activity", decided_by: "higher_seed", home_points: 0, away_points: 0 };
  assert.equal(matchStatus(seed), "Tie: higher-ranked squad wins");
  assert.equal(matchScore(seed), "0–0");
});

test("F2: a past scheduled match says its result is coming, never Scheduled", () => {
  const now = new Date("2026-11-12T13:00:00Z");
  const past = { status: "scheduled", home_points: null, away_points: null, scheduled_at: "2026-11-12T02:53:00Z" };
  const ahead = { ...past, scheduled_at: "2026-11-12T14:00:00Z" };
  assert.equal(matchStatus(past, now), "Result coming when the week is scored");
  assert.equal(matchStatus(ahead, now), "Scheduled");
  assert.equal(matchStatus({ ...past, status: "played", home_points: 3, away_points: 1 }, now), "Played");
});
