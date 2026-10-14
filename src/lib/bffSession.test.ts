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

test("BFF signup uses same-origin cookie auth and returns only safe session data", async () => {
  const originalFetch =
    globalThis.fetch;

  try {
    let seenInput = "";
    let seenInit:
      RequestInit | undefined;

    globalThis.fetch =
      async (
        input,
        init,
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
              id:
                "00000000-0000-0000-0000-000000000003",
              email:
                "new@example.test",
              email_confirmed_at:
                null,
              role:
                "authenticated",
              user_metadata: {
                full_name:
                  "New Student",
                account_type:
                  "student",
              },
            },
            expires_at:
              123456,
          },
        });
      };

    const {
      signupBffSession,
    } =
      await import(
        "../integrations/google/bffSession.ts"
      );

    const session =
      await signupBffSession({
        email:
          "new@example.test",
        password:
          "Password123!",
        full_name:
          "New Student",
        account_type:
          "student",
      });

    assert.equal(
      seenInput,
      "/api/auth/signup",
    );

    assert.equal(
      seenInit?.credentials,
      "same-origin",
    );

    assert.equal(
      new Headers(
        seenInit?.headers,
      ).get("authorization"),
      null,
    );

    assert.equal(
      session.user.email,
      "new@example.test",
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});

test("BFF account update uses cookie session without Authorization", async () => {
  const originalFetch =
    globalThis.fetch;

  try {
    let seenInput = "";
    let seenInit:
      RequestInit | undefined;

    globalThis.fetch =
      async (
        input,
        init,
      ) => {
        seenInput =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;

        seenInit = init;

        return Response.json({
          user: {
            id:
              "00000000-0000-0000-0000-000000000004",
            email:
              "user@example.test",
            email_confirmed_at:
              "2026-10-07T00:00:00.000Z",
            role:
              "authenticated",
            user_metadata: {},
          },
        });
      };

    const {
      updateBffUser,
    } =
      await import(
        "../integrations/google/bffSession.ts"
      );

    await updateBffUser({
      password:
        "NewPassword123!",
    });

    assert.equal(
      seenInput,
      "/api/auth/update",
    );

    assert.equal(
      seenInit?.credentials,
      "same-origin",
    );

    assert.equal(
      new Headers(
        seenInit?.headers,
      ).get("authorization"),
      null,
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});

test("password reset helpers use BFF action routes", async () => {
  const originalFetch =
    globalThis.fetch;

  try {
    const seen:
      string[] = [];

    globalThis.fetch =
      async (
        input,
      ) => {
        seen.push(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );

        return Response.json({
          ok: true,
        });
      };

    const {
      requestBffPasswordReset,
      verifyBffPasswordReset,
      completeBffPasswordReset,
    } =
      await import(
        "../integrations/google/bffSession.ts"
      );

    await requestBffPasswordReset(
      "user@example.test",
    );

    await verifyBffPasswordReset(
      "CODE",
    );

    await completeBffPasswordReset(
      "CODE",
      "Password123!",
    );

    assert.deepEqual(
      seen,
      [
        "/api/auth/password-reset/request",
        "/api/auth/password-reset/verify",
        "/api/auth/password-reset/complete",
      ],
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});

test("email verification and resend stay behind BFF", async () => {
  const originalFetch =
    globalThis.fetch;

  try {
    const seen:
      string[] = [];

    globalThis.fetch =
      async (
        input,
      ) => {
        seen.push(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );

        return Response.json({
          ok: true,
        });
      };

    const {
      resendBffVerification,
      verifyBffEmail,
    } =
      await import(
        "../integrations/google/bffSession.ts"
      );

    await verifyBffEmail(
      "VERIFY",
    );

    await resendBffVerification(
      "student",
    );

    assert.deepEqual(
      seen,
      [
        "/api/auth/verify-email",
        "/api/auth/resend-verification",
      ],
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});
