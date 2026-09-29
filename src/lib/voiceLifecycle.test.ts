// Run: node --test src/lib/voiceLifecycle.test.ts
// (Node 22.6-22.17 need the flag: node --experimental-strip-types --test <files>; Node 22.18+ / 23.6+ strip types by default)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEpoch, createSafeStore, createUploadRegistry, markerBelongsTo, scoreToShow, type KeyValueStore,
} from "./voiceLifecycle.ts";

// ---------- epoch: stale continuations ----------
test("a continuation from before close/abandon/new recording is stale", () => {
  const e = createEpoch();
  const started = e.current;
  assert.equal(e.isCurrent(started), true);
  e.next(); // close
  assert.equal(e.isCurrent(started), false);
  const again = e.current;
  e.next(); // new recording
  assert.equal(e.isCurrent(again), false);
});

test("stale poll: a response for an old epoch must not touch the UI", async () => {
  const e = createEpoch();
  const applied: string[] = [];
  let release!: () => void;
  const slowPoll = async (epoch: number) => {
    await new Promise<void>((r) => { release = r; });
    if (e.isCurrent(epoch)) applied.push("old");
  };
  const p = slowPoll(e.current);
  e.next();                    // dialog closed / recording changed while the poll was in flight
  release();
  await p;
  assert.deepEqual(applied, []);
});

// ---------- upload registry ----------
test("an upload in flight is visible to a new dialog instance before any marker exists", () => {
  const reg = createUploadRegistry();
  const tok = reg.begin("slot");
  assert.equal(reg.isActive("slot"), true);   // reopened dialog must wait, not record again
  reg.end("slot", tok);
  assert.equal(reg.isActive("slot"), false);
});

test("only the save that started can end it; listeners fire on begin and end", () => {
  const reg = createUploadRegistry();
  const seen: boolean[] = [];
  const off = reg.subscribe("slot", () => seen.push(reg.isActive("slot")));
  const first = reg.begin("slot");
  const second = reg.begin("slot");           // replaced (should not happen, but must be safe)
  reg.end("slot", first);                     // stale token: ignored
  assert.equal(reg.isActive("slot"), true);
  reg.end("slot", second);
  assert.equal(reg.isActive("slot"), false);
  off();
  reg.begin("slot");
  assert.deepEqual(seen, [true, true, false]);
});

test("slots are independent", () => {
  const reg = createUploadRegistry();
  reg.begin("a");
  assert.equal(reg.isActive("b"), false);
});

// ---------- safe store ----------
const throwing: KeyValueStore = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("SecurityError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};
test("blocked localStorage: values survive in memory for this page", () => {
  const s = createSafeStore(() => throwing);
  s.set("k", "v");
  assert.equal(s.get("k"), "v");
  s.remove("k");
  assert.equal(s.get("k"), null);
});
test("storage getter itself throwing is handled", () => {
  const s = createSafeStore(() => { throw new Error("no localStorage"); });
  s.set("k", "v");
  assert.equal(s.get("k"), "v");
});
test("working storage is used and preferred", () => {
  const m = new Map<string, string>();
  const real: KeyValueStore = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  const s = createSafeStore(() => real);
  s.set("k", "v");
  assert.equal(m.get("k"), "v");
  m.set("k", "fresh");               // e.g. another tab
  assert.equal(s.get("k"), "fresh");
  s.remove("k");
  assert.equal(m.has("k"), false);
});

// ---------- score gating ----------
test("a score is shown/exported only for status 'scored'", () => {
  assert.equal(scoreToShow("scored", 85), 85);
  assert.equal(scoreToShow("scored", 0), 0);
  assert.equal(scoreToShow("failed", 85), null);
  assert.equal(scoreToShow("recorded", 85), null);
  assert.equal(scoreToShow(null, 85), null);
  assert.equal(scoreToShow("scored", null), null);
  assert.equal(scoreToShow("scored", Number.NaN), null);
});

// ---------- recovery marker ownership ----------
test("a stale poll never clears a newer recording's marker", () => {
  assert.equal(markerBelongsTo("B", "A"), false);
  assert.equal(markerBelongsTo("A", "A"), true);
  assert.equal(markerBelongsTo(null, "A"), false);
});

// ---------- real elapsed-time recording limit ----------
import { exportEntry, recordedSeconds, recordingClock } from "./voiceLifecycle.ts";
test("the limit uses elapsed time: one late tick after 61 s still expires (throttled tab)", () => {
  const t0 = 1_000_000;
  assert.deepEqual(recordingClock(t0, t0, 60), { elapsedMs: 0, secondsLeft: 60, expired: false });
  assert.equal(recordingClock(t0, t0 + 59_400, 60).secondsLeft, 1);
  assert.equal(recordingClock(t0, t0 + 59_999, 60).expired, false);
  assert.equal(recordingClock(t0, t0 + 60_000, 60).expired, true);
  assert.deepEqual(recordingClock(t0, t0 + 61_000, 60), { elapsedMs: 61_000, secondsLeft: 0, expired: true });
});
test("recorded length is real elapsed seconds, capped at the limit", () => {
  assert.equal(recordedSeconds(0, 14_400, 60), 14);
  assert.equal(recordedSeconds(0, 95_000, 60), 60);   // tab asleep: never more than 60
  assert.equal(recordedSeconds(10, 0, 60), 0);
});

// ---------- PDF export ----------
test("PDF export carries the score only when it is the confirmed score", () => {
  assert.equal(exportEntry({ transcript: "t", score: 77, notes: "n" }, "q").score, 77);
  assert.equal(exportEntry({ transcript: "t", score: null, notes: "Too little speech to score." }, "q").score, null);
  assert.equal(exportEntry({ transcript: "t", score: Number.NaN, notes: null }, "q").score, null);
  assert.deepEqual(exportEntry({ transcript: "t", score: 5, notes: "n" }, "q"), { question: "q", transcript: "t", score: 5, feedback: "n" });
});

// ---------- partially blocked storage (reads work, writes/removals throw) ----------
function partialStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  const flags = { setThrows: false, removeThrows: false, getThrows: false };
  const store: KeyValueStore = {
    getItem: (k) => { if (flags.getThrows) throw new Error("blocked"); return m.get(k) ?? null; },
    setItem: (k, v) => { if (flags.setThrows) throw new Error("QuotaExceeded"); m.set(k, v); },
    removeItem: (k) => { if (flags.removeThrows) throw new Error("blocked"); m.delete(k); },
  };
  return { m, flags, store };
}
test("failed write: the newer in-memory value wins over an older persisted one", () => {
  const { flags, store } = partialStore({ k: "old" });
  const s = createSafeStore(() => store);
  flags.setThrows = true;
  s.set("k", "new");
  assert.equal(s.get("k"), "new");
  assert.equal(s.get("k"), "new");            // later reads too
});
test("failed removal: a tombstone keeps the removed marker from reappearing", () => {
  const { m, flags, store } = partialStore({ k: "abandoned-job" });
  const s = createSafeStore(() => store);
  flags.removeThrows = true;
  s.remove("k");
  assert.equal(s.get("k"), null);
  assert.equal(s.get("k"), null);
  assert.equal(m.get("k"), "");               // blanked where writes still work: a reload stays removed
});
test("failed removal AND failed write: still removed for this page", () => {
  const { flags, store } = partialStore({ k: "abandoned-job" });
  const s = createSafeStore(() => store);
  flags.removeThrows = true; flags.setThrows = true;
  s.remove("k");
  assert.equal(s.get("k"), null);
});
test("storage access restored: overrides are written through and storage is the truth again", () => {
  const { m, flags, store } = partialStore({ a: "old", b: "abandoned" });
  const s = createSafeStore(() => store);
  flags.setThrows = true; flags.removeThrows = true;
  s.set("a", "new");
  s.remove("b");
  flags.setThrows = false; flags.removeThrows = false;
  assert.equal(s.get("a"), "new");
  assert.equal(m.get("a"), "new");            // persisted now
  assert.equal(s.get("b"), null);
  assert.equal(m.has("b"), false);            // really removed now
  m.set("a", "from-another-tab");             // storage is authoritative again
  assert.equal(s.get("a"), "from-another-tab");
});
test("a later successful write replaces an earlier tombstone", () => {
  const { m, flags, store } = partialStore({ k: "v1" });
  const s = createSafeStore(() => store);
  flags.removeThrows = true;
  s.remove("k");
  s.set("k", "v2");                           // writes work: persisted, tombstone dropped
  assert.equal(m.get("k"), "v2");
  assert.equal(s.get("k"), "v2");
});
test("reads blocked with nothing held in memory: null, never a throw", () => {
  const { flags, store } = partialStore({ k: "v" });
  const s = createSafeStore(() => store);
  flags.getThrows = true;
  assert.equal(s.get("k"), null);
});

// ---------- requests that never answer ----------
import { audioTooLong, settleWithin } from "./voiceLifecycle.ts";
test("settleWithin: a request that never answers yields the fallback; answers and rejections pass", async () => {
  const never = new Promise<string>(() => {});
  assert.equal(await settleWithin(never, 10, "timeout"), "timeout");
  assert.equal(await settleWithin(Promise.resolve("ok"), 1000, "timeout"), "ok");
  assert.equal(await settleWithin(Promise.reject(new Error("x")), 1000, "failed"), "failed");
});

// ---------- audio length ----------
test("audio longer than the limit (plus tolerance) is refused; unknown length is not", () => {
  assert.equal(audioTooLong(60.9, 60), false);
  assert.equal(audioTooLong(62, 60), false);
  assert.equal(audioTooLong(62.5, 60), true);
  assert.equal(audioTooLong(300, 60), true);  // a suspended tab kept capturing
  assert.equal(audioTooLong(null, 60), false);
  assert.equal(audioTooLong(Number.POSITIVE_INFINITY, 60), false); // no usable length: unknown
});
