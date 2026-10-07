import assert from "node:assert/strict";
import test from "node:test";

import {
  removeStudents,
} from "./removeStudents.ts";

import {
  transcribeWithTimestamps,
} from "./transcribeAudio.ts";

test("student removal uses same-origin BFF without browser bearer token", async () => {
  const originalFetch =
    globalThis.fetch;

  try {
    let seenUrl = "";
    let seenInit:
      | RequestInit
      | undefined;

    globalThis.fetch =
      async (input, init) => {
        seenUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;

        seenInit = init;

        return Response.json({
          removed: 1,
          login_failures: [],
        });
      };

    const result =
      await removeStudents([
        "00000000-0000-0000-0000-000000000002",
      ]);

    assert.equal(
      seenUrl,
      "/api/accounts/remove",
    );

    assert.equal(
      seenInit?.credentials,
      "same-origin",
    );

    const headers =
      new Headers(
        seenInit?.headers,
      );

    assert.equal(
      headers.get("authorization"),
      null,
    );

    assert.equal(
      result.removed,
      1,
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});

test("transcription uses same-origin BFF without browser bearer token", async () => {
  const originalFetch =
    globalThis.fetch;

  try {
    let seenUrl = "";
    let seenInit:
      | RequestInit
      | undefined;

    globalThis.fetch =
      async (input, init) => {
        seenUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;

        seenInit = init;

        return Response.json({
          text: "Hello world",
          segments: [],
        });
      };

    const result =
      await transcribeWithTimestamps(
        new Blob(
          ["audio"],
          {
            type: "audio/webm",
          },
        ),
      );

    assert.equal(
      seenUrl,
      "/api/transcriber/transcribe",
    );

    assert.equal(
      seenInit?.credentials,
      "same-origin",
    );

    const headers =
      new Headers(
        seenInit?.headers,
      );

    assert.equal(
      headers.get("authorization"),
      null,
    );

    assert.equal(
      headers.get("content-type"),
      "audio/webm",
    );

    assert.equal(
      result.text,
      "Hello world",
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});
