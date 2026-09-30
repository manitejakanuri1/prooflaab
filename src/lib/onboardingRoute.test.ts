// Run: node --test src/lib/onboardingRoute.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { onboardingRoute } from "./onboardingRoute.ts";

test("admin never lands on the onboarding wizard", () => {
  assert.equal(onboardingRoute("admin"), "/admin/dashboard");
});

test("other roles keep their existing onboarding destinations", () => {
  assert.equal(onboardingRoute("college_admin"), "/onboarding/college");
  assert.equal(onboardingRoute("startup"), "/onboarding/startup");
  assert.equal(onboardingRoute("recruiter"), "/company/dashboard");
  assert.equal(onboardingRoute("something-else"), "/onboarding-wizard");
});
