// Run: node --test src/lib/voiceJob.test.ts
// (Node 22.6-22.17 need the flag: node --experimental-strip-types --test <files>; Node 22.18+ / 23.6+ strip types by default)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enqueueBody, MAX_POLL_FAILURES, mayStartNewRecording, nextFailures, parseStoredJob,
  SavedNotifier, viewOf, type JobRow, type StoredJob,
} from "./voiceJob.ts";

const row = (over: Partial<JobRow> = {}): JobRow => ({
  id: "v1", transcription_status: "completed", transcript: "hi", transcript_segments: null, word_count: 2,
  transcription_error: null, status: "recorded", communication_score: null, communication_notes: null, ...over,
});

// 3. short recordings: never final from the word count
test("short transcript is NOT final until the server decides", () => {
  assert.deepEqual(viewOf(row({ word_count: 2, status: "recorded" })), { kind: "transcribed", final: false });
  assert.deepEqual(viewOf(row({ word_count: 2, status: "failed", communication_notes: "Too little speech to score." })),
    { kind: "transcribed", final: true });
});
test("scored is final; waiting and transcription failure are distinct", () => {
  assert.deepEqual(viewOf(row({ status: "scored", communication_score: 70 })), { kind: "transcribed", final: true });
  assert.deepEqual(viewOf(row({ transcription_status: "processing" })), { kind: "waiting", status: "processing" });
  assert.deepEqual(viewOf(row({ transcription_status: null })), { kind: "waiting", status: "pending" });
  assert.deepEqual(viewOf(row({ transcription_status: "failed", transcription_error: "HTTP 404" })),
    { kind: "transcription_failed", error: "HTTP 404" });
});

// 5. duplicate callbacks
test("onSaved fires once per stage however many times polling reports it", () => {
  let calls = 0;
  const n = new SavedNotifier(() => { calls++; });
  for (let i = 0; i < 10; i++) n.notify("v1", "transcribed");
  assert.equal(calls, 1);
  for (let i = 0; i < 10; i++) n.notify("v1", "final");
  assert.equal(calls, 2);
  n.notify("v2", "transcribed");
  assert.equal(calls, 3);
});
test("onSaved: overlapping ticks resolving together still notify once", async () => {
  let calls = 0;
  const n = new SavedNotifier(() => { calls++; });
  await Promise.all(Array.from({ length: 5 }, async () => { await Promise.resolve(); n.notify("v1", "final"); }));
  assert.equal(calls, 1);
});

// 2. polling failures
test("poll failures give up after MAX_POLL_FAILURES consecutive failures; success resets", () => {
  let f = 0;
  let r = nextFailures(f, { ok: false, reason: "read_error" }); f = r.failures; assert.equal(r.giveUp, false);
  r = nextFailures(f, { ok: false, reason: "missing" }); f = r.failures; assert.equal(r.giveUp, false);
  r = nextFailures(f, { ok: true, row: row() }); f = r.failures; assert.equal(f, 0);
  for (let i = 1; i <= MAX_POLL_FAILURES; i++) {
    r = nextFailures(f, { ok: false, reason: "missing" }); f = r.failures;
    assert.equal(r.giveUp, i === MAX_POLL_FAILURES);
  }
});

// 6. enqueue retry metadata
test("retry body carries the original duration, path and idempotency key", () => {
  const job: StoredJob = { voiceId: null, idempotencyKey: "k-1", storagePath: "s1/123-explain.webm", durationSeconds: 47 };
  assert.deepEqual(enqueueBody(job, "t1", null),
    { storage_path: "s1/123-explain.webm", task_id: "t1", duration_seconds: 47, idempotency_key: "k-1" });
});
test("stored jobs round-trip; an older stored job without duration still parses", () => {
  const job: StoredJob = { voiceId: "v1", idempotencyKey: "k", storagePath: "p", durationSeconds: 12 };
  assert.deepEqual(parseStoredJob(JSON.stringify(job)), job);
  assert.deepEqual(parseStoredJob('{"voiceId":null,"idempotencyKey":"k","storagePath":"p"}'),
    { voiceId: null, idempotencyKey: "k", storagePath: "p", durationSeconds: null });
  assert.equal(parseStoredJob("not json"), null);
  assert.equal(parseStoredJob('{"voiceId":"x"}'), null);
});

// 1. lost enqueue response
test("a new recording may not replace an uncertain stored job", () => {
  const job: StoredJob = { voiceId: null, idempotencyKey: "k", storagePath: "p", durationSeconds: 5 };
  assert.equal(mayStartNewRecording(job, false), false);
  assert.equal(mayStartNewRecording(job, true), true);
  assert.equal(mayStartNewRecording(null, false), true);
});

// ---------- recovery context (student / task / proof) ----------
import { jobMatchesContext } from "./voiceJob.ts";
test("a stored job carries its student/task/proof and a retry re-sends exactly those", () => {
  const job: StoredJob = { voiceId: null, idempotencyKey: "k", storagePath: "s1/a.webm", durationSeconds: 30,
    studentId: "s1", taskId: "t1", proofId: null };
  assert.deepEqual(parseStoredJob(JSON.stringify(job)), job);
  // props now say something else: the job's own values win
  assert.deepEqual(enqueueBody(job, "t-other", "p-other"),
    { storage_path: "s1/a.webm", task_id: "t1", duration_seconds: 30, idempotency_key: "k" });
});
test("recovery is used only in the same student/task/proof context", () => {
  const ctx = (studentId: string, taskId: string | null = null, proofId: string | null = null) => ({ studentId, taskId, proofId });
  const job: StoredJob = { voiceId: "v", idempotencyKey: "k", storagePath: "p", durationSeconds: 5, studentId: "s1", taskId: "t1", proofId: null };
  assert.equal(jobMatchesContext(job, ctx("s1", "t1")), "match");
  assert.equal(jobMatchesContext(job, ctx("s2", "t1")), "other");        // account changed
  assert.equal(jobMatchesContext(job, ctx("s1", "t2")), "other");        // other task
  assert.equal(jobMatchesContext(job, ctx("s1", "t1", "p9")), "other");  // other proof under the same task
  // an older marker's key/path do not prove task or proof: "unknown", never a match
  const legacy: StoredJob = { voiceId: "v", idempotencyKey: "k", storagePath: "s1/1-explain.webm", durationSeconds: 5 };
  assert.equal(jobMatchesContext(legacy, ctx("s1", "t1")), "unknown");
  assert.equal(jobMatchesContext({ ...legacy, studentId: "s2" }, ctx("s1", "t1")), "other");
});

// ---------- slot identity ----------
import { classifyLegacy, legacySlotKey, recordingContext, slotKey } from "./voiceJob.ts";
test("slot key: student, task AND proof, nulls included - two proofs under one task never share", () => {
  const a = slotKey(recordingContext("s1", "t1", "p1"));
  const b = slotKey(recordingContext("s1", "t1", "p2"));
  const c = slotKey(recordingContext("s1", "t1", null));
  const d = slotKey(recordingContext("s1", null, "t1"));          // a proof whose id equals a task id
  const e = slotKey(recordingContext("s1", undefined, undefined));
  const f = slotKey(recordingContext("s1", null, null));
  assert.equal(new Set([a, b, c, d]).size, 4);
  assert.equal(e, f);                                              // undefined and null are the same "none"
  assert.notEqual(slotKey(recordingContext("s1.t1", null, null)), slotKey(recordingContext("s1", "t1", null)));
  // the old key really was shared: that is why older markers need checking
  assert.equal(legacySlotKey(recordingContext("s1", "t1", "p1")), legacySlotKey(recordingContext("s1", "t1", "p2")));
});

test("legacy marker: only the server's own row decides; failure or absence never guesses", () => {
  const here = recordingContext("s1", "t1", "p2");
  const byKey: StoredJob = { voiceId: null, idempotencyKey: "k", storagePath: "s1/1-explain.webm", durationSeconds: 20 };
  const byId: StoredJob = { ...byKey, voiceId: "v1" };
  const row = (task_id: string | null, proof_id: string | null, student_id = "s1") =>
    ({ id: "v1", student_id, task_id, proof_id, storage_path: "s1/1-explain.webm" });
  // lookup failed / timed out: unresolved, and no "attach here" offered
  assert.deepEqual(classifyLegacy(byKey, here, undefined), { kind: "unresolved", canAttach: false });
  // never reached the server: unresolved; the student may explicitly attach it
  assert.deepEqual(classifyLegacy(byKey, here, null), { kind: "unresolved", canAttach: true });
  // had a voiceId but the row is gone/invisible: unresolved, no attach
  assert.deepEqual(classifyLegacy(byId, here, null), { kind: "unresolved", canAttach: false });
  // same task, different proof: belongs elsewhere - never attached here
  assert.deepEqual(classifyLegacy(byKey, here, row("t1", "p1")), { kind: "elsewhere" });
  assert.deepEqual(classifyLegacy(byKey, here, row("t1", "p2", "s2")), { kind: "elsewhere" });
  // proven ours: stamped with the full context and the server's id
  assert.deepEqual(classifyLegacy(byKey, here, row("t1", "p2")),
    { kind: "ours", job: { ...byKey, voiceId: "v1", studentId: "s1", taskId: "t1", proofId: "p2" } });
});

test("a recording the server heard as another language asks for English, in plain words", () => {
  const v = viewOf({ transcription_status: "failed", transcription_error: "non_english", status: "failed" } as never);
  assert.deepEqual(v, { kind: "transcription_failed", error: "Please record your explanation in English." });
});
