// Run: node --test src/lib/blobUrlOwner.test.ts
// (Node 22.6-22.17 need: node --experimental-strip-types --test ...)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBlobUrlOwner, withoutLocalAudio } from "./blobUrlOwner.ts";

const owner = () => {
  const revoked: string[] = [];
  return { o: createBlobUrlOwner((u) => revoked.push(u)), revoked };
};

test("replacement: adopting a new recording revokes the previous URL", () => {
  const { o, revoked } = owner();
  o.adopt("blob:1");
  o.adopt("blob:2");
  assert.deepEqual(revoked, ["blob:1"]);
  assert.equal(o.current, "blob:2");
});

test("failed save / close / unmount: release revokes once, repeat is harmless", () => {
  const { o, revoked } = owner();
  o.adopt("blob:1");
  o.release();
  o.release();
  assert.deepEqual(revoked, ["blob:1"]);
  assert.equal(o.current, null);
});

test("adopting the same URL twice does not revoke it", () => {
  const { o, revoked } = owner();
  o.adopt("blob:1");
  o.adopt("blob:1");
  assert.deepEqual(revoked, []);
});

test("release with nothing adopted does nothing", () => {
  const { o, revoked } = owner();
  o.release();
  assert.deepEqual(revoked, []);
});

test("after release the result falls back to storagePath, never a revoked URL", () => {
  const saved = { transcript: "t", audioUrl: "blob:1", storagePath: "s/a.webm" };
  const after = withoutLocalAudio(saved);
  assert.equal(after?.audioUrl, undefined);
  assert.equal(after?.storagePath, "s/a.webm");
  assert.equal("audioUrl" in (after ?? {}), false);
  assert.equal(withoutLocalAudio(null), null);
  const noUrl: { transcript: string; storagePath: string; audioUrl?: string } = { transcript: "t", storagePath: "p" };
  assert.equal(withoutLocalAudio(noUrl), noUrl);
});
