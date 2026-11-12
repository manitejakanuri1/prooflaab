import { test } from "node:test";
import assert from "node:assert/strict";
import { plural } from "./plural.ts";

test("plural picks the word by count", () => {
  assert.equal(plural(1, "student"), "1 student");
  assert.equal(plural(0, "student"), "0 students");
  assert.equal(plural(2, "Lot"), "2 Lots");
  assert.equal(plural(1200, "student"), "1,200 students");
  assert.equal(plural(undefined, "squad"), "0 squads");
  assert.equal(plural(1, "company", "companies"), "1 company");
  assert.equal(plural(3, "company", "companies"), "3 companies");
});
