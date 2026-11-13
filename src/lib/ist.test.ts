import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDay, fmtDayTime, istDayEnd, istWall, istYmd, pastDueIST } from "./ist.ts";

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

test("N2: India day, not the UTC day; a picked day is due 11:59:59 PM India time", () => {
  assert.equal(istYmd(new Date("2026-11-12T20:30:00Z")), "2026-11-13"); // 2 AM IST 13 Nov (UTC still says 12)
  assert.equal(istDayEnd("2026-11-15"), "2026-11-15T18:29:59.000Z");
  assert.equal(istDayEnd(new Date(2026, 10, 15)), "2026-11-15T18:29:59.000Z"); // picker gives local 15 Nov
  assert.equal(istDayEnd(new Date(2026, 10, 15, 23, 59, 59, 999)), "2026-11-15T18:29:59.000Z"); // endOfDay(picked)
  assert.equal(fmtDay(istDayEnd("2026-11-15")), "15 Nov 2026");
});

