import assert from "node:assert/strict";
import test from "node:test";
import { studentNotificationLink as to } from "./notificationLink.ts";

test("old rows with the bare dashboard link open their own page", () => {
  assert.equal(to({ type: "squad_placed", link: "/student/dashboard" }), "/student/dashboard?tab=squad");
  assert.equal(to({ type: "announcement", link: "/student/dashboard", dedupe_key: "announcement-abc" }),
    "/student/dashboard?tab=lab&announcement=abc");
  assert.equal(to({ type: "announcement", link: "/student/dashboard" }), "/student/dashboard?tab=lab");
  assert.equal(to({ type: "something_new", link: "/student/dashboard" }), "/student/dashboard");
});

test("a specific link is kept", () => {
  assert.equal(to({ type: "reminder", link: "/student/tasks/assigned?open=1" }), "/student/tasks/assigned?open=1");
  assert.equal(to({ type: "squad_placed", link: "/student/dashboard?tab=squad" }), "/student/dashboard?tab=squad");
});
