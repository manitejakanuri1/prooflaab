import assert from "node:assert/strict";
import test from "node:test";

import {
  bffFileFetch,
  bffFileUrl,
} from "../integrations/google/bffFiles.ts";

test("private file paths go to same-origin /api/files", () => {
  assert.equal(
    bffFileUrl(
      "proof-files",
      "student-1/resume.pdf",
    ),
    "/api/files/proof-files/student-1/resume.pdf",
  );
});

test("reserved file-name characters are encoded, not treated as URL syntax", () => {
  assert.equal(
    bffFileUrl(
      "proof-files",
      "student-1/my resume #1?.pdf",
    ),
    "/api/files/proof-files/student-1/my%20resume%20%231%3F.pdf",
  );
});

test("file transport rejects traversal paths", () => {
  assert.throws(
    () =>
      bffFileUrl(
        "proof-files",
        "../secret.txt",
      ),
    /Invalid storage path/,
  );

  assert.throws(
    () =>
      bffFileUrl(
        "proof-files",
        "student/../../secret.txt",
      ),
    /Invalid storage path/,
  );
});

test("file transport rejects invalid buckets", () => {
  assert.throws(
    () =>
      bffFileUrl(
        "../bucket",
        "file.pdf",
      ),
    /Invalid storage bucket/,
  );
});

test("private file fetch uses cookie session and strips browser credentials", async () => {
  const originalFetch =
    globalThis.fetch;

  try {
    let seenUrl = "";
    let seenInit:
      | RequestInit
      | undefined;

    globalThis.fetch =
      async (
        input:
          | string
          | URL
          | Request,
        init?: RequestInit,
      ) => {
        seenUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;

        seenInit = init;

        return new Response(
          JSON.stringify({
            path:
              "student/resume.pdf",
          }),
          {
            status: 200,
            headers: {
              "Content-Type":
                "application/json",
            },
          },
        );
      };

    await bffFileFetch(
      "/api/files/proof-files/student/resume.pdf",
      {
        method: "PUT",
        headers: {
          Authorization:
            "Bearer browser-token",
          apikey: "browser-key",
          Cookie:
            "manual-cookie",
          "Content-Type":
            "application/pdf",
          "x-upsert": "true",
        },
        body: new Uint8Array([
          1,
          2,
          3,
        ]),
      },
    );

    assert.equal(
      seenUrl,
      "/api/files/proof-files/student/resume.pdf",
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
      headers.get("apikey"),
      null,
    );

    assert.equal(
      headers.get("cookie"),
      null,
    );

    assert.equal(
      headers.get("content-type"),
      "application/pdf",
    );

    assert.equal(
      headers.get("x-upsert"),
      "true",
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});
