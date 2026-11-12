import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDay, fmtDayTime, istWall, pastDueIST } from "./ist.ts";

test("sweep M12/M13: India time and one date format, whatever the device clock", () => {
  assert.equal(fmtDay("2026-11-10T19:22:49Z"), "11 Nov 2026"); // 00:52 IST next day
  assert.equal(fmtDay("2026-11-10"), "10 Nov 2026");
  assert.match(fmtDayTime("2026-11-11T10:44:00Z"), /^11 Nov 2026, 4:14 pm IST$/i);
  assert.equal(fmtDay(null), "—");
});

test("istWall: 2 AM Thursday in India is Thursday whatever the device time zone", () => {
  const w = istWall(new Date("2026-11-11T20:30:00Z")); // 02:00 IST, 12 Nov
  assert.equal([w.getFullYear(), w.getMonth() + 1, w.getDate(), w.getHours(), w.getMinutes()].join(" "), "2026 11 12 2 0");
});

test("P6: a Lot due 10 or 11 Nov is past due on 12 Nov (India days), one due today is not", () => {
  const now = new Date("2026-11-12T04:00:00Z"); // 9:30 AM IST, 12 Nov
  assert.equal(pastDueIST("2026-11-10T18:29:00Z", now), true);  // 11:59 PM IST, 10 Nov
  assert.equal(pastDueIST("2026-11-11T18:29:00Z", now), true);  // 11:59 PM IST, 11 Nov
  assert.equal(pastDueIST("2026-11-11T18:31:00Z", now), false); // 12:01 AM IST, 12 Nov = today
  assert.equal(pastDueIST("2026-11-21T00:00:00Z", now), false);
  assert.equal(pastDueIST(null, now), false);
});
