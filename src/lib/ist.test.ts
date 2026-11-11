import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDay, fmtDayTime } from "./ist.ts";

test("sweep M12/M13: India time and one date format, whatever the device clock", () => {
  assert.equal(fmtDay("2026-11-10T19:22:49Z"), "11 Nov 2026"); // 00:52 IST next day
  assert.equal(fmtDay("2026-11-10"), "10 Nov 2026");
  assert.match(fmtDayTime("2026-11-11T10:44:00Z"), /^11 Nov 2026, 4:14 pm IST$/i);
  assert.equal(fmtDay(null), "—");
});
