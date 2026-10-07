import assert from "node:assert/strict";
import test from "node:test";

import {
  endBffSession,
  readBffSession,
  startBffSession,
} from "../integrations/google/bffSession.ts";

test("BFF login uses same-origin cookie session and sends no bearer token", async () => {
  const originalFetch = globalThis.fetch;

  try {
    let seenInput = "";
    let seenInit: RequestInit | undefined;

    globalThis.fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      seenInput =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      seenInit = init;

      return Response.json({
        session: {
          user: {
            id: "00000000-0000-0000-0000-000000000001",
            email: "student@example.test",
            email_confirmed_at: null,
            role: "authenticated",
            user_metadata: {},
          },
          expires_at: 123456,
        },
      });
    };

    const session = await startBffSession(
      "student@example.test",
      "pw",
    );

    assert.equal(seenInput, "/api/auth/login");
    assert.equal(seenInit?.method, "POST");
    assert.equal(seenInit?.credentials, "same-origin");

    const headers = new Headers(seenInit?.headers);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("content-type"), "application/json");

    assert.deepEqual(
      JSON.parse(String(seenInit?.body)),
      {
        email: "student@example.test",
        password: "pw",
      },
    );

    assert.equal(
      session.user.id,
      "00000000-0000-0000-0000-000000000001",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BFF session lookup returns only safe session data", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      Response.json({
        session: {
          user: {
            id: "00000000-0000-0000-0000-000000000002",
            email: "user@example.test",
            email_confirmed_at: null,
            role: "authenticated",
            user_metadata: {},
          },
          expires_at: 456789,
        },
      });

    const session = await readBffSession();

    assert.equal(
      session?.user.id,
      "00000000-0000-0000-0000-000000000002",
    );
    assert.equal(session?.expires_at, 456789);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BFF session lookup accepts a signed-out response", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      Response.json({ session: null });

    assert.equal(await readBffSession(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BFF logout is a same-origin POST", async () => {
  const originalFetch = globalThis.fetch;

  try {
    let seenInit: RequestInit | undefined;

    globalThis.fetch = async (_input, init) => {
      seenInit = init;
      return Response.json({ ok: true });
    };

    await endBffSession();

    assert.equal(seenInit?.method, "POST");
    assert.equal(seenInit?.credentials, "same-origin");

    const headers = new Headers(seenInit?.headers);
    assert.equal(headers.get("authorization"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BFF login surfaces the server's safe error", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      Response.json(
        { error: "Invalid login credentials" },
        { status: 401 },
      );

    await assert.rejects(
      () =>
        startBffSession(
          "student@example.test",
          "pw",
        ),
      /Invalid login credentials/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
