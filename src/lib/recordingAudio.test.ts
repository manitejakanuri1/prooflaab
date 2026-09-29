// Run: node --test src/lib/recordingAudio.test.ts src/lib/voiceStatus.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAudioLoader, type AudioState } from "./recordingAudio.ts";

function harness(download: (p: string) => Promise<{ data: Blob | null; error: unknown }>) {
  const created: string[] = [];
  const revoked: string[] = [];
  const states: AudioState[] = [];
  let n = 0;
  const loader = createAudioLoader({
    download,
    createUrl: () => { const u = `blob:test/${++n}`; created.push(u); return u; },
    revoke: (u) => revoked.push(u),
    onChange: (s) => states.push(s),
  });
  return { loader, created, revoked, states };
}
const blob = () => new Blob(["x"]);

test("success: url set, loading ends", async () => {
  const h = harness(async () => ({ data: blob(), error: null }));
  await h.loader.load("s/a.webm");
  assert.deepEqual(h.loader.state, { url: "blob:test/1", loading: false, failed: false });
});

test("error result: failed, loading ends, retry succeeds", async () => {
  let fail = true;
  const h = harness(async () => (fail ? { data: null, error: { message: "404" } } : { data: blob(), error: null }));
  await h.loader.load("p");
  assert.deepEqual(h.loader.state, { url: null, loading: false, failed: true });
  fail = false;
  await h.loader.load("p");
  assert.deepEqual(h.loader.state, { url: "blob:test/1", loading: false, failed: false });
});

test("thrown download: failed and loading ends (never stuck)", async () => {
  const h = harness(async () => { throw new Error("network down"); });
  await h.loader.load("p");
  assert.equal(h.loader.state.loading, false);
  assert.equal(h.loader.state.failed, true);
});

test("missing data without error: failed", async () => {
  const h = harness(async () => ({ data: null, error: null }));
  await h.loader.load("p");
  assert.equal(h.loader.state.failed, true);
});

test("second click while loading is ignored (one download)", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const h = harness(async () => { calls++; await gate; return { data: blob(), error: null }; });
  const a = h.loader.load("p");
  const b = h.loader.load("p");
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(h.created.length, 1);
});

test("reload replaces and revokes the previous blob URL; dispose revokes the last", async () => {
  const h = harness(async () => ({ data: blob(), error: null }));
  await h.loader.load("p");
  await h.loader.load("p");
  assert.deepEqual(h.revoked, ["blob:test/1"]);
  h.loader.dispose();
  assert.deepEqual(h.revoked, ["blob:test/1", "blob:test/2"]);
});

test("disposed while downloading: no blob URL is created, nothing leaks", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const h = harness(async () => { await gate; return { data: blob(), error: null }; });
  const p = h.loader.load("p");
  h.loader.dispose();
  release();
  await p;
  assert.equal(h.created.length, 0);
  assert.equal(h.revoked.length, 0);
});

test("no path: nothing happens", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { data: blob(), error: null }; });
  await h.loader.load(null);
  await h.loader.load("");
  assert.equal(calls, 0);
});
