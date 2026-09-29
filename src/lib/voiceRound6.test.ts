// Step 6 round-5 audit (N1, N2) regressions. Each block first reproduces the
// defect with the logic the previous build used, then shows the correction.
// Run: node --test src/lib/voiceRound6.test.ts
// (Node 22.6-22.17 need: node --experimental-strip-types --test <files>)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSafeStore, HEARTBEAT_STALE_MS, ownerOf, type KeyValueStore } from "./voiceLifecycle.ts";
import {
  asideStatus, markerKey, mayForgetRecord, parseStoredJob, recordingContext, type OwnerRow, type StoredJob,
} from "./voiceJob.ts";

/** A localStorage stand-in shared by two "tabs" (and surviving reloads). */
function sharedStorage() {
  const m = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
  };
  return { m, store };
}
const ctx = recordingContext("s1", "t1", "p-new");
const aside: StoredJob = {
  voiceId: null, idempotencyKey: "k1", storagePath: "s1/r1-explain.webm", durationSeconds: 20,
  ...ctx, recordingId: "r1", stage: "uploaded", aside: true, heartbeatAt: 0, createdAt: 1,
};
const row = (over: Partial<OwnerRow> = {}): OwnerRow => ({
  id: "v1", student_id: "s1", task_id: "t1", proof_id: "p-new", storage_path: "s1/r1-explain.webm",
  transcription_idempotency_key: "k1", ...over,
});

// ---------- N2: kept-aside "Check" must verify the full ownership and context ----------
test("N2 defect reproduced: the previous 'path OR key' test called another proof's row 'saved'", () => {
  const other = row({ proof_id: "p-old" });
  const previous = other.storage_path === aside.storagePath || other.transcription_idempotency_key === aside.idempotencyKey;
  assert.equal(previous, true);                                   // the previous build showed "Saved" here
  assert.notEqual(asideStatus(other, aside), "saved");            // corrected: never "saved" for this work
});
test("N2 corrected: every field decides - saved only on a full match", () => {
  assert.equal(asideStatus(row(), aside), "saved");
  assert.equal(asideStatus(row({ transcription_idempotency_key: null }), aside), "saved");  // key cleared server-side, path matches
  assert.equal(asideStatus(row({ proof_id: "p-old" }), aside), "saved-elsewhere");          // same recording, other proof
  assert.equal(asideStatus(row({ task_id: "t-other" }), aside), "saved-elsewhere");         // same recording, other task
  assert.equal(asideStatus(row({ transcription_idempotency_key: "k-other" }), aside), "conflict");   // same path, other key
  assert.equal(asideStatus(row({ storage_path: "s1/other.webm", transcription_idempotency_key: "k-other" }), aside), "conflict");
  assert.equal(asideStatus(row({ student_id: "s2" }), aside), "conflict");                  // never another student's
  assert.equal(asideStatus(undefined, aside), "unknown");         // the check failed: inconclusive
  assert.equal(asideStatus(null, aside), "none");                 // genuinely no row
  // an older record without task/proof: it can be "saved for its own work", never "saved for this work"
  const legacy: StoredJob = { ...aside, taskId: undefined, proofId: undefined };
  assert.equal(asideStatus(row(), legacy), "saved-elsewhere");
});

// ---------- N1: a stale heartbeat never licenses deleting another tab's unfinished record ----------
test("N1 defect reproduced: the previous Remove deleted a suspended tab's record once its heartbeat was 15 s old", () => {
  const { store } = sharedStorage();
  const tabA = createSafeStore(() => store), tabB = createSafeStore(() => store);
  const key = markerKey("r1");
  tabA.set(key, JSON.stringify({ ...aside, aside: false, stage: "uploading", tabId: "A", heartbeatAt: 10_000 }));
  assert.equal(ownerOf(parseStoredJob(tabB.get(key))!, "B", 10_001), "other-page");          // Remove disabled
  assert.equal(ownerOf(parseStoredJob(tabB.get(key))!, "B", 10_000 + HEARTBEAT_STALE_MS + 1), "nobody");  // ...then enabled
  tabB.remove(key);                                               // the previous Remove: an unconditional delete
  assert.equal(tabA.get(key), null);                              // A (only suspended) has lost its record
});
test("N1 corrected: only a server-confirmed job allows deleting; otherwise Remove only hides", () => {
  assert.equal(mayForgetRecord(undefined), false);                // never checked
  assert.equal(mayForgetRecord("unknown"), false);                // check failed
  assert.equal(mayForgetRecord("none"), false);                   // no job (another tab may still be sending it)
  assert.equal(mayForgetRecord("conflict"), false);
  assert.equal(mayForgetRecord("saved"), true);                   // the server has this recording's job
  assert.equal(mayForgetRecord("saved-elsewhere"), true);         // ...for its original work: the local pointer is not needed
  // hiding keeps the record readable for the tab that may still finish it, and that tab's own
  // progress (it rewrites the record from its copy) brings it back
  const { store } = sharedStorage();
  const tabA = createSafeStore(() => store), tabB = createSafeStore(() => store);
  const key = markerKey("r1");
  tabA.set(key, JSON.stringify({ ...aside, aside: false, stage: "uploading", tabId: "A", heartbeatAt: 10_000 }));
  tabB.set(key, JSON.stringify({ ...parseStoredJob(tabB.get(key)), aside: true, dismissed: true }));
  assert.equal(parseStoredJob(tabA.get(key))?.dismissed, true);
  tabA.set(key, JSON.stringify({ ...parseStoredJob(tabA.get(key)), stage: "uploaded", dismissed: false }));  // A completes
  assert.equal(parseStoredJob(tabB.get(key))?.dismissed, undefined);
  assert.equal(parseStoredJob(tabB.get(key))?.stage, "uploaded");
});
