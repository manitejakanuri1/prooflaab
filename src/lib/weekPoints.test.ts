import { test } from "node:test";
import assert from "node:assert/strict";
import { latestWeeks, weekChangeText } from "./weekPoints.ts";

test("latest 8 weeks of the newest season, in week order", () => {
  const rows = [12, 11, 7, 6, 10, 9, 8, 1, 2, 3, 4, 5].map((w, i) =>
    ({ season_id: "s2", week: w, points: w, computed_at: `2026-11-${String(10 + i).padStart(2, "0")}` }));
  rows.push({ season_id: "s1", week: 13, points: 99, computed_at: "2026-10-01" });
  const out = latestWeeks(rows);
  assert.deepEqual(out.map((r) => r.week), [5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(weekChangeText(out), "+9% vs the week before");   // 12 vs 11
  assert.equal(weekChangeText(out.slice(-1)), "No earlier week");
  assert.deepEqual(latestWeeks([]), []);
});
