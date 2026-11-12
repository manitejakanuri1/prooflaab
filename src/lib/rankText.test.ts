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

import { pickNextMatch, seedLine } from "./rankText.ts";

test("R1: next match is never a time already gone", () => {
  const now = new Date("2026-11-12T10:30:00Z");
  const past = { status: "scheduled", scheduled_at: "2026-11-12T00:01:00Z" };
  const soon = { status: "scheduled", scheduled_at: "2026-11-12T11:00:00Z" };
  const later = { status: "scheduled", scheduled_at: "2026-11-19T11:00:00Z" };
  const played = { status: "played", scheduled_at: "2026-11-12T12:00:00Z" };
  assert.deepEqual(pickNextMatch([later, past, played, soon], now), { next: soon, waiting: past });
  assert.deepEqual(pickNextMatch([past], now), { next: null, waiting: past });
});

test("R2: seed words match the knockout rules", () => {
  const three = [{ seed: 1, points: 5 }, { seed: 2, points: 3 }, { seed: 3, points: 0 }];
  assert.equal(seedLine({ seed: 1, bracket: "CSE-A" }, three)?.long, "Bye to the final as seed 1.");
  assert.equal(seedLine({ seed: 2, bracket: "CSE-A" }, three)?.long, "Through to the semi-final as seed 2.");
  const four = [...three, { seed: 4, points: 1 }, { seed: null, points: 0 }];
  assert.equal(seedLine({ seed: 1, bracket: "CSE-A" }, four)?.long, "Through to the semi-final as seed 1.");
  assert.equal(seedLine({ seed: 2, bracket: "X" }, [{ seed: 1, points: 2 }, { seed: 2, points: 1 }])?.long, "Through to the final as seed 2.");
  const zero = three.map((s) => ({ ...s, points: 0 }));
  assert.match(seedLine({ seed: 1, bracket: "CSE-A" }, zero)!.long, /no final or champion/);
  assert.equal(seedLine({ seed: null, bracket: "CSE-A", points: 4 }, three), null);
});

test("R2 (345): 0-point squads do not qualify unless the whole section has 0", () => {
  const sec = [{ seed: 1, points: 6 }, { seed: 2, points: 3 }, { seed: null, points: 0 }];
  assert.equal(seedLine({ seed: null, bracket: "CSE-A", points: 0 }, sec)?.long, "Did not qualify - 0 league points.");
  assert.equal(seedLine({ seed: 1, bracket: "CSE-A", points: 6 }, sec)?.long, "Through to the final as seed 1.");
  const one = [{ seed: 1, points: 3 }, { seed: null, points: 0 }];
  assert.match(seedLine({ seed: 1, bracket: "CSE-B", points: 3 }, one)!.long, /champion without a knockout match/);
  const allZero = [{ seed: 1, points: 0 }, { seed: 2, points: 0 }, { seed: 3, points: 0 }];
  assert.match(seedLine({ seed: 2, bracket: "CSE-A", points: 0 }, allZero)!.long, /no final or champion/);
  assert.equal(seedLine({ seed: null, bracket: null, points: 0 }, sec), null);
});

import { whenFormatFor } from "./rankText.ts";

test("R4: fixtures of different weeks on one day show the time; weekly fixtures show the date", () => {
  const sameDay = [{ scheduled_at: "2026-11-12T06:00:00Z", round_number: 1 }, { scheduled_at: "2026-11-12T06:10:00Z", round_number: 2 }];
  assert.equal(whenFormatFor(sameDay), "d MMM, h:mm a");
  const weekly = [{ scheduled_at: "2026-11-12T12:30:00Z", round_number: 1 }, { scheduled_at: "2026-11-12T12:30:00Z", round_number: 1 }, { scheduled_at: "2026-11-19T12:30:00Z", round_number: 2 }];
  assert.equal(whenFormatFor(weekly), "d MMM");
  assert.equal(whenFormatFor(weekly, true), "d MMM, h:mm a");
});
