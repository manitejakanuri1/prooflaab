import assert from "node:assert/strict";
import test from "node:test";
import { nextUnread, readText } from "./courseText.ts";

test("full course: progress line and next chapter", () => {
  assert.equal(readText(12, 85), "12 of 85 read");
  assert.equal(readText(3, 3), "All 3 chapters read");
  assert.equal(nextUnread(new Set([1, 2, 4]), 5), 3);
  assert.equal(nextUnread(new Set([1, 2]), 2), 1);
});
