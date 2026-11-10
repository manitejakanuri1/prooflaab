import { test } from "node:test";
import assert from "node:assert/strict";
import { liveStreak } from "./streak.ts";

test("streak stays alive only through the previous Lot day", () => {
  assert.equal(liveStreak(3, "2026-11-10", "2026-11-10"), 3);   // counted today
  assert.equal(liveStreak(3, "2026-11-09", "2026-11-10"), 3);   // Tue, Monday done
  assert.equal(liveStreak(3, "2026-11-07", "2026-11-10"), 0);   // Tue, Monday missed (QA week 8 case)
  assert.equal(liveStreak(3, "2026-11-07", "2026-11-09"), 3);   // Mon, Saturday done
  assert.equal(liveStreak(3, "2026-11-07", "2026-11-08"), 3);   // Sun rest day
  assert.equal(liveStreak(3, null, "2026-11-10"), 0);
});
