// Run: node --test src/lib/voiceStatus.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingStatus, STATUS_LABEL, type RecordingStatusInput } from "./voiceStatus.ts";

const r = (o: Partial<RecordingStatusInput>): RecordingStatusInput =>
  ({ transcription_status: "completed", transcript_source: "server", status: "recorded", ...o });
const label = (o: Partial<RecordingStatusInput>) => STATUS_LABEL[recordingStatus(r(o))];

test("transcription failure -> Failed (whatever the scoring status)", () => {
  assert.equal(label({ transcription_status: "failed" }), "Failed");
  assert.equal(label({ transcription_status: "failed", status: "failed" }), "Failed");
});
test("transcription still running -> Transcribing", () => {
  assert.equal(label({ transcription_status: "pending" }), "Transcribing");
  assert.equal(label({ transcription_status: "processing" }), "Transcribing");
});
test("scoring failure incl. too little speech -> Not scored (never 'Completed')", () => {
  assert.equal(label({ status: "failed" }), "Not scored");
  assert.equal(label({ status: "failed", transcript_source: "browser" }), "Not scored");
});
test("server transcript awaiting the server's score -> Scoring", () => {
  assert.equal(label({ status: "recorded", transcript_source: "server" }), "Scoring");
});
test("scored -> Scored (server or legacy)", () => {
  assert.equal(label({ status: "scored" }), "Scored");
  assert.equal(label({ status: "scored", transcript_source: "browser", transcription_status: null }), "Scored");
});
test("legacy self-reported, not scored -> Not scored, never pending", () => {
  assert.equal(label({ transcription_status: null, transcript_source: "browser", status: "recorded" }), "Not scored");
  assert.equal(label({ transcription_status: null, transcript_source: null, status: null }), "Not scored");
  assert.equal(label({ transcription_status: "completed", transcript_source: "manual", status: "recorded" }), "Not scored");
});
