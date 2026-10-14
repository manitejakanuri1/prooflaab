import assert from "node:assert/strict";
import test from "node:test";

import {
  rewriteBffUrl,
  sanitizeBffHeaders,
} from "../integrations/google/bffTransport.ts";

const ORIGIN = "https://prooflab.example";

test("database table traffic moves to /api/db and keeps its query", () => {
  assert.equal(
    rewriteBffUrl(
      `${ORIGIN}/rest/v1/profiles?select=id%2Cemail`,
      "db",
      ORIGIN,
    ),
    `${ORIGIN}/api/db/profiles?select=id%2Cemail`,
  );
});

test("database RPC traffic keeps the rpc path", () => {
  assert.equal(
    rewriteBffUrl(
      `${ORIGIN}/rest/v1/rpc/get_dashboard`,
      "db",
      ORIGIN,
    ),
    `${ORIGIN}/api/db/rpc/get_dashboard`,
  );
});

test("function traffic moves to /api/functions", () => {
  assert.equal(
    rewriteBffUrl(
      `${ORIGIN}/functions/v1/send-onboarding-email?trace=1`,
      "function",
      ORIGIN,
    ),
    `${ORIGIN}/api/functions/send-onboarding-email?trace=1`,
  );
});

test("BFF transport refuses cross-origin targets", () => {
  assert.throws(
    () =>
      rewriteBffUrl(
        "https://evil.example/rest/v1/profiles",
        "db",
        ORIGIN,
      ),
    /cross-origin/,
  );
});

test("BFF transport refuses unexpected generated paths", () => {
  assert.throws(
    () =>
      rewriteBffUrl(
        `${ORIGIN}/storage/v1/object/test`,
        "db",
        ORIGIN,
      ),
    /unexpected path/,
  );

  assert.throws(
    () =>
      rewriteBffUrl(
        `${ORIGIN}/functions/v1/a/b`,
        "function",
        ORIGIN,
      ),
    /invalid function name/,
  );
});

test("browser credentials are stripped but application headers survive", () => {
  const headers = sanitizeBffHeaders(
    {
      Authorization: "Bearer browser-token",
      apikey: "browser-api-key",
      Cookie: "should-not-be-forwarded-manually",
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "x-request-id": "req-123",
    },
  );

  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("apikey"), null);
  assert.equal(headers.get("cookie"), null);

  assert.equal(
    headers.get("content-type"),
    "application/json",
  );

  assert.equal(
    headers.get("prefer"),
    "return=representation",
  );

  assert.equal(
    headers.get("x-request-id"),
    "req-123",
  );
});
