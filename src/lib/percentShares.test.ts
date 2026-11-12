import assert from "node:assert/strict";
import test from "node:test";
import { percentShares } from "./percentShares.ts";

test("readiness weights without project proof add up to 100", () => {
  const p = percentShares([20, 20, 30, null, 15]);
  assert.deepEqual(p, [24, 24, 35, null, 17]);
  assert.equal(p.reduce<number>((a, v) => a + (v ?? 0), 0), 100);
});

test("all parts present keep their own weights", () => {
  assert.deepEqual(percentShares([20, 20, 30, 15, 15]), [20, 20, 30, 15, 15]);
});

test("nothing assessed gives no shares", () => {
  assert.deepEqual(percentShares([null, null]), [null, null]);
});

test("three equal parts still add up to 100", () => {
  const p = percentShares([1, 1, 1]);
  assert.equal(p.reduce<number>((a, v) => a + (v ?? 0), 0), 100);
});
