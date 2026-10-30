import test from "node:test";
import assert from "node:assert/strict";
import { roleHome } from "./roleHome.ts";

test("MF-048: every role has its own dashboard", () => {
  assert.equal(roleHome("admin"), "/admin/dashboard");
  assert.equal(roleHome("college_admin"), "/college/dashboard");
  assert.equal(roleHome("startup"), "/company/dashboard");
  assert.equal(roleHome("recruiter"), "/company/dashboard");
  assert.equal(roleHome("student"), "/student/dashboard");
});
