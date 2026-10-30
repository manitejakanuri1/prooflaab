import test from "node:test";
import assert from "node:assert/strict";
import { squadsForStudent } from "./squadSection.ts";

const squads = [
  { id: "a1", cohort: "CSE-A" }, { id: "b1", cohort: "CSE-B" }, { id: "a2", cohort: " CSE-A " }, { id: "g", cohort: null },
];
test("Assign lists only squads of the student's own section (MF-011)", () => {
  assert.deepEqual(squadsForStudent(squads, "CSE-A").map((s) => s.id), ["a1", "a2"]);
  assert.deepEqual(squadsForStudent(squads, "CSE-B").map((s) => s.id), ["b1"]);
  assert.deepEqual(squadsForStudent(squads, "GENERAL").map((s) => s.id), ["g"]);
});
test("no student chosen yet: no squad to pick", () => {
  assert.deepEqual(squadsForStudent(squads, undefined), []);
});
