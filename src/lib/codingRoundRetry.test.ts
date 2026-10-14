import assert from "node:assert/strict";
import test from "node:test";

import { codingErrorMessage, MAX_CODING_RETRIES, retryAllowance } from "./codingRoundRetry.ts";

test("the server's explanation is shown, not the transport's generic line", () => {
  const generic = new Error("Edge Function returned a non-2xx status code");
  assert.equal(
    codingErrorMessage(generic, { error: "Could not prepare coding problems right now. Please try again in a minute." }),
    "Could not prepare coding problems right now. Please try again in a minute.",
  );
  // No body at all: a plain sentence, and it says the score is safe. Never the generic line.
  const fallback = codingErrorMessage(generic, null);
  assert.match(fallback, /quiz score is saved/);
  assert.doesNotMatch(fallback, /non-2xx|Edge Function/);
  assert.doesNotMatch(codingErrorMessage(new TypeError("Failed to fetch"), null), /Failed to fetch/);
  // A real message from our own code is kept; a body without a usable error is ignored.
  assert.equal(codingErrorMessage(new Error("Sign in again."), { error: 42 }), "Sign in again.");
  assert.equal(codingErrorMessage("boom", {}).includes("saved"), true);
  assert.ok(codingErrorMessage(generic, { error: "x".repeat(900) }).length <= 300);
});

test("retries are bounded, wait longer each time, and then stop", () => {
  assert.deepEqual(retryAllowance(0), { allowed: true, waitSeconds: 0, left: 3 });
  assert.deepEqual(retryAllowance(1), { allowed: true, waitSeconds: 20, left: 2 });
  assert.deepEqual(retryAllowance(2), { allowed: true, waitSeconds: 60, left: 1 });
  assert.deepEqual(retryAllowance(MAX_CODING_RETRIES), { allowed: false, waitSeconds: 0, left: 0 });
  assert.equal(retryAllowance(99).allowed, false);
  // A damaged saved value can never unlock extra retries or crash.
  assert.deepEqual(retryAllowance(Number.NaN), { allowed: true, waitSeconds: 0, left: 3 });
  assert.equal(retryAllowance(-5).left, 3);
});
