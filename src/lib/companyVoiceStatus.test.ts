import assert from "node:assert/strict";
import test from "node:test";
import { companyVoiceText } from "./companyVoiceStatus.ts";

test("company voice words: scored, single try, multiple tries, none", () => {
  assert.equal(companyVoiceText(72), "Voice 7.2/10");
  assert.equal(companyVoiceText(80), "Voice 8/10");
  assert.equal(companyVoiceText(null, 1), "1 voice try, not scored");
  assert.equal(companyVoiceText(undefined, 2), "2 voice tries, not scored");
  assert.equal(companyVoiceText(null, 3), "3 voice tries, not scored");
  assert.equal(companyVoiceText(null, 0), "No voice yet");
  assert.equal(companyVoiceText(undefined), "No voice yet");
});
