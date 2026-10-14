import assert from "node:assert/strict";
import test from "node:test";

import {
  openExternal,
  safeExternalUrl,
  safeInternalPath,
} from "./safeNavigation.ts";

function installWindow(
  origin = "https://prooflab.co.in",
) {
  const calls: Array<{
    url: string;
    target?: string;
    features?: string;
  }> = [];

  Object.defineProperty(
    globalThis,
    "window",
    {
      configurable: true,
      value: {
        location: {
          origin,
        },
        open(
          url: string,
          target?: string,
          features?: string,
        ) {
          calls.push({
            url,
            target,
            features,
          });

          return {};
        },
      },
    },
  );

  return calls;
}

test("safeExternalUrl accepts normal https URL", () => {
  assert.equal(
    safeExternalUrl(
      "https://example.com/course?q=1#top",
    ),
    "https://example.com/course?q=1#top",
  );
});

test("safeExternalUrl accepts normal http URL", () => {
  assert.equal(
    safeExternalUrl(
      "http://example.com/resource",
    ),
    "http://example.com/resource",
  );
});

test("safeExternalUrl rejects javascript URL", () => {
  assert.equal(
    safeExternalUrl(
      "javascript:alert(1)",
    ),
    null,
  );
});

test("safeExternalUrl rejects data URL", () => {
  assert.equal(
    safeExternalUrl(
      "data:text/html,<script>alert(1)</script>",
    ),
    null,
  );
});

test("safeExternalUrl rejects blob and file URLs", () => {
  assert.equal(
    safeExternalUrl(
      "blob:https://example.com/abc",
    ),
    null,
  );

  assert.equal(
    safeExternalUrl(
      "file:///etc/passwd",
    ),
    null,
  );
});

test("safeExternalUrl rejects malformed or empty input", () => {
  assert.equal(
    safeExternalUrl(
      "not a valid url",
    ),
    null,
  );

  assert.equal(
    safeExternalUrl(""),
    null,
  );

  assert.equal(
    safeExternalUrl(null),
    null,
  );
});

test("safeInternalPath accepts same-origin absolute path", () => {
  installWindow();

  assert.equal(
    safeInternalPath(
      "/student/dashboard?tab=proof#latest",
    ),
    "/student/dashboard?tab=proof#latest",
  );
});

test("safeInternalPath rejects protocol-relative URL", () => {
  installWindow();

  assert.equal(
    safeInternalPath(
      "//evil.example/path",
    ),
    null,
  );
});

test("safeInternalPath rejects external absolute URL", () => {
  installWindow();

  assert.equal(
    safeInternalPath(
      "https://evil.example/path",
    ),
    null,
  );
});

test("safeInternalPath rejects non-path input", () => {
  installWindow();

  assert.equal(
    safeInternalPath(
      "student/dashboard",
    ),
    null,
  );
});

test("openExternal refuses dangerous scheme", () => {
  const calls = installWindow();

  assert.equal(
    openExternal(
      "javascript:alert(1)",
    ),
    false,
  );

  assert.equal(
    calls.length,
    0,
  );
});

test("openExternal uses noopener and noreferrer", () => {
  const calls = installWindow();

  assert.equal(
    openExternal(
      "https://example.com/resource",
    ),
    true,
  );

  assert.equal(
    calls.length,
    1,
  );

  assert.equal(
    calls[0].url,
    "https://example.com/resource",
  );

  assert.equal(
    calls[0].target,
    "_blank",
  );

  assert.equal(
    calls[0].features,
    "noopener,noreferrer",
  );
});
