import assert from "node:assert/strict";
import test from "node:test";
import { maskAll, maskEmail, maskIp, plainError, shortIds, shortRequestId } from "./mask.ts";

test("masks email, IP and UUID", () => {
  assert.equal(maskEmail("vikram.c@gmail.com"), "v***@gmail.com");
  assert.equal(maskIp("203.0.113.45"), "203.0.113.*");
  assert.equal(maskIp("2401:4900:1c2a:5b3e::1"), "2401:4900:1c2a:*");
  assert.equal(shortIds("id 3f2b9c1a-1111-2222-3333-444455556666 x"), "id 3f2b9c1a… x");
  assert.equal(maskAll("user a@b.co from 10.1.2.3"), "user a***@b.co from 10.1.2.*");
  assert.equal(maskAll(null), "");
});

test("plain errors", () => {
  assert.match(plainError("Uncaught TypeError: Failed to fetch dynamically imported module: data:..."), /did not load/);
  assert.equal(plainError("HTTP 500"), "Server error (HTTP 500)");
  assert.equal(plainError("HTTP ?"), "HTTP ?");
  assert.equal(plainError("Cannot read properties of undefined (reading 'x')"), "Page code error");
  assert.equal(plainError("x".repeat(100)).length, 80);
});

test("F14: shortens request id to last 4-6 chars", () => {
  assert.equal(shortRequestId("f47ac10b-58cc-4372-a567-0e02b2c3d479"), "c3d479");
  assert.equal(shortRequestId("req_123456"), "123456");
  assert.equal(shortRequestId("abcd"), "abcd");
  assert.equal(shortRequestId(null), "");
  assert.equal(shortRequestId(undefined), "");
});
