import assert from "node:assert/strict";
import test from "node:test";
import { taskMatchesSkill } from "./taskMatchesSkill.ts";

test("taskMatchesSkill matches by category, skills array, or title", () => {
  assert.equal(taskMatchesSkill({ title: "Git: Rebase workflow", category: "Version Control", skills: ["Git"] }, "Git"), true);
  assert.equal(taskMatchesSkill({ title: "Working with branches", category: "Git", skills: [] }, "Git"), true);
  assert.equal(taskMatchesSkill({ title: "Git basics", category: null, skills: [] }, "Git"), true);
  assert.equal(taskMatchesSkill({ title: "Python functions", category: "Python", skills: [] }, "Git"), false);
});
