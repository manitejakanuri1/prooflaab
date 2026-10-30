import test from "node:test";
import assert from "node:assert/strict";
import { voiceStatusOf } from "./voiceStatusText.ts";

test("MF-114: only a scored recording counts as done", () => {
  assert.equal(voiceStatusOf("scored"), "scored");
  assert.equal(voiceStatusOf("failed"), "failed");
  assert.equal(voiceStatusOf("pending"), "checking");
  assert.equal(voiceStatusOf(null), "checking");
});
