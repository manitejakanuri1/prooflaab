import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtIST } from "./ist.ts";

test("UTC 12:33 is shown as 18:03 IST on any computer clock", () => {
  assert.match(fmtIST("2026-11-10T12:33:00Z"), /10 Nov.*18:03 IST$/);
});
