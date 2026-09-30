// Step 6 round 7 (round-6 review items): the exact rules for rows with a NULL key or
// path, and for file paths that more than one row uses. Each block first shows the
// previous behaviour, then the corrected one.
// Run: node --test src/lib/voiceRound7.test.ts
// (Node 22.6-22.17 need: node --experimental-strip-types --test <files>)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asideStatus, classifyLegacy, mayForgetRecord, pickUnique, recordingContext, rowMatchesMarker,
  type OwnerRow, type StoredJob,
} from "./voiceJob.ts";

const ctx = recordingContext("s1", "t1", "p2");
const record: StoredJob = {
  voiceId: null, idempotencyKey: "k1", storagePath: "s1/shared-explain.webm", durationSeconds: 11,
  ...ctx, recordingId: "r1", stage: "uploaded", aside: true, heartbeatAt: 0, createdAt: 1,
};
const row = (over: Partial<OwnerRow> = {}): OwnerRow => ({
  id: "v1", student_id: "s1", task_id: "t1", proof_id: "p2", storage_path: "s1/shared-explain.webm",
  transcription_idempotency_key: null, ...over,
});

// ---------- reused paths ----------
test("reused path, defect reproduced: taking the first of several rows 'identified' the recording", () => {
  const rows = [row({ id: "a", proof_id: "p2" }), row({ id: "b", proof_id: "p1" })];
  const previous = rows.slice(0, 1)[0];                                  // the previous lookup used limit(1)
  assert.equal(asideStatus(previous, record), "saved");                 // ...and one of them looked like a full match
  assert.equal(asideStatus(pickUnique(rows), record), "ambiguous");     // corrected: two rows share the path
});
test("pickUnique: 0 rows none, 1 row that row, 2+ ambiguous, failed lookup unknown", () => {
  assert.equal(pickUnique([]), null);
  assert.deepEqual(pickUnique([row()]), row());
  assert.equal(pickUnique([row(), row({ id: "v2" })]), "ambiguous");
  assert.equal(pickUnique(undefined), undefined);
});
test("an ambiguous answer never identifies, never attaches, never licenses deleting", () => {
  assert.equal(asideStatus("ambiguous", record), "ambiguous");
  assert.equal(mayForgetRecord("ambiguous"), false);
  const legacy: StoredJob = { voiceId: null, idempotencyKey: "k1", storagePath: "s1/shared-explain.webm", durationSeconds: 11 };
  assert.deepEqual(classifyLegacy(legacy, ctx, "ambiguous"), { kind: "unresolved", canAttach: false });
});

// ---------- NULL key / NULL path rules ----------
test("NULL key on the row: only a matching path (from a unique path lookup) can identify it", () => {
  assert.equal(asideStatus(row(), record), "saved");                                          // unique path + context
  assert.equal(asideStatus(row({ storage_path: "s1/other.webm" }), record), "conflict");      // key null, path differs
  assert.equal(asideStatus(row({ storage_path: null }), record), "conflict");                 // neither identifies
});
test("a key that IS set must equal the record's key, whatever the path says", () => {
  assert.equal(asideStatus(row({ transcription_idempotency_key: "k-other" }), record), "conflict");
  assert.equal(asideStatus(row({ transcription_idempotency_key: "k1" }), record), "saved");
  assert.equal(rowMatchesMarker(row({ transcription_idempotency_key: "k-other" }), record, ctx), false);
});
test("an older record: key or path identify it; context decides between ours and elsewhere", () => {
  const legacy: StoredJob = { voiceId: null, idempotencyKey: "k1", storagePath: "s1/shared-explain.webm", durationSeconds: 11 };
  assert.equal(classifyLegacy(legacy, ctx, row()).kind, "ours");                             // unique path, same work
  assert.equal(classifyLegacy(legacy, ctx, row({ proof_id: "p1" })).kind, "elsewhere");
  assert.deepEqual(classifyLegacy(legacy, ctx, row({ storage_path: "s1/x.webm" })), { kind: "unresolved", canAttach: false });
});
