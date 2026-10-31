import test from "node:test";
import assert from "node:assert/strict";
import { micErrorText, voiceStatusOf } from "./voiceStatusText.ts";

test("MF-042: a microphone error says how to fix it and that the student may record later", () => {
  assert.match(micErrorText({ name: "NotAllowedError" }), /lock icon.*Allow/);
  assert.match(micErrorText({ name: "NotFoundError" }), /No microphone found/);
  assert.match(micErrorText(null), /blocked/);
  assert.match(micErrorText(new Error("x")), /record later/);
});

test("MF-114: only a scored recording counts as done", () => {
  assert.equal(voiceStatusOf("scored"), "scored");
  assert.equal(voiceStatusOf("failed"), "failed");
  assert.equal(voiceStatusOf("pending"), "checking");
  assert.equal(voiceStatusOf(null), "checking");
});
