import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("new portfolio creation defaults to private", () => {
  const hook = source("../hooks/usePortfolio.tsx");

  assert.match(hook, /is_public:\s*false\s*,/);
  assert.doesNotMatch(hook, /is_public:\s*true\s*,/);
});

test("student retains explicit sharing toggle", () => {
  const privacy = source(
    "../components/dashboard/student/StudentPrivacy.tsx"
  );

  assert.match(privacy, /is_public:\s*on/);
});

test("public BFF route requires published portfolio", () => {
  const route = source("../../web-bff/publicRoutes.ts");

  assert.match(route, /is_public:\s*["']eq\.true["']/);
  assert.match(
    route,
    /student_profiles\.profile_visibility/
  );
});
