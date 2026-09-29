// Step 6 round-3 audit (F1-F9) regressions. Each block first reproduces the
// defect with the protocol the previous build used, then shows the correction.
// Run: node --test src/lib/voiceRound4.test.ts
// (Node 22.6-22.17 need: node --experimental-strip-types --test <files>)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSafeStore, createUploadRegistry, existenceOf, HEARTBEAT_STALE_MS, moveDurably, ownerOf, recordingPath,
  uploadOutcome, type KeyValueStore,
} from "./voiceLifecycle.ts";
import {
  classifyLegacy, jobMatchesContext, legacySlotKey, markerKey, MARKER_PREFIX, parseStoredJob, pickResumable,
  recordingContext, rowMatchesMarker, slotKey, type StoredJob,
} from "./voiceJob.ts";

/** A localStorage stand-in shared by "tabs" and surviving "reloads". */
function sharedStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  const flags = { setThrows: false, removeThrows: false };
  const store: KeyValueStore = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { if (flags.setThrows) throw new Error("QuotaExceededError"); m.set(k, v); },
    removeItem: (k) => { if (flags.removeThrows) throw new Error("blocked"); m.delete(k); },
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
  };
  return { m, flags, store };
}
const ctxA = recordingContext("s1", "t1", "p1");
const job = (over: Partial<StoredJob> = {}): StoredJob => ({
  voiceId: null, idempotencyKey: "k1", storagePath: "s1/r1-explain.webm", durationSeconds: 20, ...over,
});

// ---------- F1: writes fail, removal works, then a reload ----------
test("F1 defect reproduced: old move (set, read back, remove) loses the record after a reload", () => {
  const { m, flags, store } = sharedStorage({ [legacySlotKey(ctxA)]: JSON.stringify(job()) });
  const page = createSafeStore(() => store);
  flags.setThrows = true;                                    // quota: writes fail, removal works
  const newKey = markerKey("k1");
  page.set(newKey, JSON.stringify(job()));                   // lands in memory only
  if (page.get(newKey)) page.remove(legacySlotKey(ctxA));    // previous build: "readable" => delete old
  const reloaded = createSafeStore(() => store);             // full page reload
  assert.equal(reloaded.get(newKey), null);
  assert.equal(reloaded.get(legacySlotKey(ctxA)), null);     // both gone: the defect
  assert.equal(m.size, 0);
});
test("F1 corrected: moveDurably keeps the old record until the new one is really stored", () => {
  const { flags, store } = sharedStorage({ [legacySlotKey(ctxA)]: JSON.stringify(job()) });
  const page = createSafeStore(() => store);
  flags.setThrows = true;
  const newKey = markerKey("k1");
  assert.equal(moveDurably(page, legacySlotKey(ctxA), newKey, JSON.stringify(job())), false);
  assert.equal(page.get(legacySlotKey(ctxA)), null);         // hidden on this page (no double handling)...
  assert.ok(page.get(newKey));                               // ...the new copy serves this page
  const reloaded = createSafeStore(() => store);
  assert.ok(reloaded.get(legacySlotKey(ctxA)));              // ...and after a reload the original is still there
  flags.setThrows = false;                                   // storage works again: the move completes
  assert.equal(moveDurably(reloaded, legacySlotKey(ctxA), newKey, JSON.stringify(job())), true);
  const again = createSafeStore(() => store);
  assert.ok(again.get(newKey));
  assert.equal(again.get(legacySlotKey(ctxA)), null);
});
test("F1: set/remove report durability honestly (memory-only is never 'stored')", () => {
  const { flags, store } = sharedStorage();
  const s = createSafeStore(() => store);
  assert.equal(s.set("k", "v"), true);
  flags.setThrows = true;
  assert.equal(s.set("k", "v2"), false);
  assert.equal(s.get("k"), "v2");                            // readable on this page...
  assert.equal(createSafeStore(() => store).get("k"), "v");  // ...but not stored
  flags.removeThrows = true;
  assert.equal(s.remove("k"), false);
});
test("F1/F6 set-aside is an in-place flag on the recording's own record: nothing is moved or deleted", () => {
  const { flags, store } = sharedStorage();
  const s = createSafeStore(() => store);
  const key = markerKey("r1");
  s.set(key, JSON.stringify(job({ recordingId: "r1", ...ctxA, stage: "uploaded" })));
  flags.setThrows = true;                                    // marking it aside fails to persist
  s.set(key, JSON.stringify({ ...parseStoredJob(s.get(key)), aside: true }));
  const reloaded = createSafeStore(() => store);
  assert.ok(reloaded.get(key));                              // still there after reload (not lost; just not aside)
});

// ---------- F2: two tabs, one browser storage ----------
test("F2 defect reproduced: one record per slot - tab B's save overwrites tab A's", () => {
  const { store } = sharedStorage();
  const tabA = createSafeStore(() => store), tabB = createSafeStore(() => store);
  const regA = createUploadRegistry(), regB = createUploadRegistry();   // page-local: they cannot see each other
  regA.begin(slotKey(ctxA));
  assert.equal(regB.isActive(slotKey(ctxA)), false);
  tabA.set(slotKey(ctxA), JSON.stringify(job({ idempotencyKey: "kA" })));
  tabB.set(slotKey(ctxA), JSON.stringify(job({ idempotencyKey: "kB" })));
  assert.equal(parseStoredJob(tabA.get(slotKey(ctxA)))?.idempotencyKey, "kB");   // A's recovery details gone
});
test("F2 corrected: one record per recording - both tabs' records survive and are listed", () => {
  const { store } = sharedStorage();
  const tabA = createSafeStore(() => store), tabB = createSafeStore(() => store);
  tabA.set(markerKey("rA"), JSON.stringify(job({ idempotencyKey: "kA", recordingId: "rA", ...ctxA })));
  tabB.set(markerKey("rB"), JSON.stringify(job({ idempotencyKey: "kB", recordingId: "rB", ...ctxA })));
  const keys = createSafeStore(() => store).keys(MARKER_PREFIX);
  assert.deepEqual(keys, [markerKey("rA"), markerKey("rB")]);
});
test("F2: heartbeat ownership - another live tab's recording is left alone; a dead tab's is picked up", () => {
  const now = 1_000_000;
  assert.equal(ownerOf({ tabId: "A", heartbeatAt: now - 1000 }, "A", now), "this-page");
  assert.equal(ownerOf({ tabId: "A", heartbeatAt: now - 1000 }, "B", now), "other-page");
  assert.equal(ownerOf({ tabId: "A", heartbeatAt: now - HEARTBEAT_STALE_MS - 1 }, "B", now), "nobody");   // crashed
  assert.equal(ownerOf({ tabId: "A", heartbeatAt: 0 }, "B", now), "nobody");                               // page left (pagehide)
  assert.equal(ownerOf({}, "B", now), "nobody");
  const e = (id: string, over: Partial<StoredJob>) => ({ key: markerKey(id), job: job({ recordingId: id, ...ctxA, ...over }) });
  const entries = [
    e("live", { tabId: "A", heartbeatAt: now, createdAt: 3 }),
    e("dead", { tabId: "A", heartbeatAt: 0, createdAt: 2 }),
    e("aside", { aside: true, createdAt: 4 }),
    e("other-proof", { proofId: "p2", createdAt: 5 }),
  ];
  const r = pickResumable(entries, ctxA, (j) => ownerOf(j, "B", now));
  assert.equal(r.next?.job.recordingId, "dead");
  assert.equal(r.otherPages, 1);
});

// ---------- F5: what an upload result proves ----------
test("F5: only a real answer decides; a lost answer is 'unknown', never 'not uploaded'", () => {
  assert.equal(uploadOutcome({ error: null }), "stored");
  assert.equal(uploadOutcome({ error: { statusCode: "409" } }), "stored");       // it already exists
  assert.equal(uploadOutcome({ error: { statusCode: "413" } }), "refused");
  assert.equal(uploadOutcome({ error: {} }), "unknown");                         // no answer (network)
  assert.equal(uploadOutcome("timeout"), "unknown");
  assert.equal(existenceOf({ data: new Uint8Array(1), error: null }), true);
  assert.equal(existenceOf({ data: null, error: { statusCode: "404" } }), false);
  assert.equal(existenceOf({ data: null, error: { statusCode: "500" } }), undefined);
  assert.equal(existenceOf({ data: null, error: {} }), undefined);
  assert.equal(existenceOf("timeout"), undefined);
});

// ---------- F7: storage paths ----------
test("F7 defect reproduced: clock-based paths collide in the same millisecond", () => {
  const frozen = 1_700_000_000_000;
  const oldPath = (student: string) => `${student}/${frozen}-explain.webm`;   // previous build's formula
  assert.equal(oldPath("s1"), oldPath("s1"));
});
test("F7 corrected: paths come from each recording's own random id", () => {
  const a = recordingPath("s1", crypto.randomUUID(), "webm");
  const b = recordingPath("s1", crypto.randomUUID(), "webm");
  assert.notEqual(a, b);
  assert.match(a, /^s1\/[0-9a-f-]{36}-explain\.webm$/);
});

// ---------- F8: authoritative row checks ----------
test("F8 defect reproduced: a forged local record 'matches' though the server row is another proof's", () => {
  const forged = job({ ...ctxA, voiceId: "v-other" });
  assert.equal(jobMatchesContext(forged, ctxA), "match");     // local fields alone said yes
});
test("F8 corrected: the row's own student/task/proof, path and key must all agree", () => {
  const mine = job({ ...ctxA, voiceId: "v1" });
  const row = { id: "v1", student_id: "s1", task_id: "t1", proof_id: "p1", storage_path: "s1/r1-explain.webm", transcription_idempotency_key: "k1" };
  assert.equal(rowMatchesMarker(row, mine, ctxA), true);
  assert.equal(rowMatchesMarker({ ...row, proof_id: "p2" }, mine, ctxA), false);                 // other proof
  assert.equal(rowMatchesMarker({ ...row, student_id: "s2" }, mine, ctxA), false);               // other student
  assert.equal(rowMatchesMarker({ ...row, storage_path: "s1/other.webm" }, mine, ctxA), false);  // other recording
  assert.equal(rowMatchesMarker({ ...row, transcription_idempotency_key: "k9" }, mine, ctxA), false);
  assert.equal(rowMatchesMarker({ ...row, transcription_idempotency_key: null }, mine, ctxA), true); // key cleared server-side
  // an older marker found by a stale voiceId that points at another recording decides nothing
  const legacy = job({ voiceId: "v1" });
  assert.deepEqual(classifyLegacy(legacy, ctxA, { ...row, storage_path: "s1/other.webm", transcription_idempotency_key: "k9" }),
    { kind: "unresolved", canAttach: false });
});
