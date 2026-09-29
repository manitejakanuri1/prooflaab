// Run: node --test src/lib/voiceStatus.test.ts
// (Node 22.6-22.17 need the flag: node --experimental-strip-types --test <files>; Node 22.18+ / 23.6+ strip types by default)
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

// ---------- provenance ----------
import { displayScore, provenance, PROVENANCE_LABEL } from "./voiceStatus.ts";
const prov = (o: Partial<RecordingStatusInput>) => PROVENANCE_LABEL[provenance(r(o))];

test("pending/processing server recording is 'Verifying', never 'Self-reported'", () => {
  assert.equal(prov({ transcription_status: "pending", transcript_source: "server" }), "Verifying");
  assert.equal(prov({ transcription_status: "processing", transcript_source: "server" }), "Verifying");
  // even if the source column were not yet 'server', an in-flight job is server work
  assert.equal(prov({ transcription_status: "pending", transcript_source: "browser" }), "Verifying");
  assert.equal(prov({ transcription_status: "processing", transcript_source: null }), "Verifying");
});
test("failed server transcription is 'Verification failed'", () => {
  assert.equal(prov({ transcription_status: "failed", transcript_source: "server" }), "Verification failed");
});
test("completed server transcript is 'Server-verified'", () => {
  assert.equal(prov({ transcription_status: "completed", transcript_source: "server" }), "Server-verified");
});
test("legacy rows are 'Self-reported' (scored or not)", () => {
  assert.equal(prov({ transcription_status: null, transcript_source: "browser", status: "scored" }), "Self-reported");
  assert.equal(prov({ transcription_status: "completed", transcript_source: "manual", status: "recorded" }), "Self-reported");
  assert.equal(prov({ transcription_status: null, transcript_source: null, status: null }), "Self-reported");
});

// ---------- score display ----------
test("score shown only when Scored", () => {
  assert.equal(displayScore(r({ status: "scored", communication_score: 85 })), 85);
  assert.equal(displayScore(r({ status: "scored", communication_score: 0 })), 0);
});
test("inconsistent records never show a number", () => {
  assert.equal(displayScore(r({ status: "failed", communication_score: 85 })), null);        // Not scored + 85
  assert.equal(displayScore(r({ status: "recorded", communication_score: 85 })), null);      // Scoring + 85
  assert.equal(displayScore(r({ transcription_status: "failed", status: "scored", communication_score: 85 })), null); // Failed + 85
  assert.equal(displayScore(r({ transcription_status: "processing", status: "scored", communication_score: 85 })), null);
  assert.equal(displayScore(r({ status: "scored", communication_score: null })), null);
});
test("legacy scored record shows its number and is labelled Self-reported", () => {
  const legacy = r({ transcription_status: null, transcript_source: "browser", status: "scored", communication_score: 72 });
  assert.equal(displayScore(legacy), 72);
  assert.equal(PROVENANCE_LABEL[provenance(legacy)], "Self-reported");
});
test("legacy unscored record with a stray score shows no number", () => {
  assert.equal(displayScore(r({ transcription_status: null, transcript_source: "browser", status: "recorded", communication_score: 40 })), null);
});
