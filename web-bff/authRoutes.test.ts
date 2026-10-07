import { handleAuthRoute } from "./authRoutes.ts";
import { makeSessionCookie, type PrivateSession } from "./session.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const NOW = 1_800_000_000_000;
const SESSION_ID = "A".repeat(43);
const USER_ID = "00000000-0000-0000-0000-000000000001";

function env() {
  const values: Record<string, string> = {
    GOOGLE_API_KEY: "TEST_GOOGLE_KEY",
    AUTH_BRIDGE_URL: "https://bridge.example.test",
  };

  return {
    get(name: string) {
      return values[name];
    },
  };
}

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

function stored(
  appExpiresAt = NOW + 60 * 60 * 1000,
): PrivateSession {
  return {
    v: 1,
    googleRefreshToken: "SERVER_ONLY_REFRESH_TOKEN",
    appAccessToken: "SERVER_ONLY_APP_TOKEN",
    appAccessExpiresAt: appExpiresAt,
    expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
    user: {
      id: USER_ID,
      email: "student@example.test",
      email_confirmed_at: "2026-10-07T00:00:00.000Z",
      role: "authenticated",
      user_metadata: {},
    },
  };
}

Deno.test("login creates server session and returns only opaque cookie", async () => {
  let created: PrivateSession | null = null;
  let createdId = "";

  const fetcher: typeof fetch = async (input) => {
    const url = String(input);

    if (url.includes("signInWithPassword")) {
      return Response.json({
        email: "student@example.test",
        idToken: "GOOGLE_ID_TOKEN",
        refreshToken: "GOOGLE_REFRESH_TOKEN",
      });
    }

    if (url === "https://bridge.example.test/token") {
      return Response.json({
        access_token: jwt({
          sub: USER_ID,
          role: "authenticated",
          email_confirmed: true,
        }),
        expires_in: 3600,
      });
    }

    throw new Error(`unexpected URL: ${url}`);
  };

  const req = new Request(
    "https://prooflab.co.in/api/auth/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "student@example.test",
        password: "password",
      }),
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    fetcher,
    now: () => NOW,
    newSessionId: () => SESSION_ID,
    loadLoginIdentity: async () => ({
      allowed: true,
      role: "student",
      full_name: "Managed Student",
      account_type: "student",
      has_completed_wizard: true,
      college_id: "00000000-0000-0000-0000-000000000099",
      onboarding_status: "completed",
    }),
    createSession: async (id, session) => {
      createdId = id;
      created = session;
    },
  });

  assert(res !== null, "login route not handled");
  assert(res.status === 200, "login failed");

  const body = await res.json();

  assert(createdId === SESSION_ID, "wrong opaque session id");
  assert(created !== null, "server session not stored");

  const text = JSON.stringify(body);

  assert(!text.includes("GOOGLE_REFRESH_TOKEN"), "refresh token leaked");
  assert(!text.includes("access_token"), "access token field leaked");
  assert(!text.includes("GOOGLE_ID_TOKEN"), "Google id token leaked");

  const cookie = res.headers.get("Set-Cookie") ?? "";

  assert(cookie.includes("HttpOnly"), "HttpOnly missing");
  assert(cookie.includes("Secure"), "Secure missing");
  assert(cookie.includes("SameSite=Strict"), "SameSite missing");
});

Deno.test("login refuses an account not provisioned by the platform", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);

    if (
      url.includes(
        "signInWithPassword",
      )
    ) {
      return Response.json({
        email: "orphan@example.test",
        idToken: "GOOGLE_ID_TOKEN",
        refreshToken: "GOOGLE_REFRESH_TOKEN",
      });
    }

    if (
      url ===
        "https://bridge.example.test/token"
    ) {
      return Response.json({
        access_token: jwt({
          sub: USER_ID,
          role: "authenticated",
          email_confirmed: true,
        }),
        expires_in: 3600,
      });
    }

    throw new Error(
      `unexpected URL: ${url}`,
    );
  };

  const req = new Request(
    "https://prooflab.co.in/api/auth/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "orphan@example.test",
        password: "password",
      }),
    },
  );

  const res = await handleAuthRoute(
    req,
    {
      env: env(),
      fetcher,
      loadLoginIdentity: async () => ({
        allowed: false,
        reason: "account_not_provisioned",
      }),
      createSession: async () => {
        throw new Error(
          "refused login must not create session",
        );
      },
    },
  );

  assert(
    res !== null,
    "login route not handled",
  );

  assert(
    res.status === 403,
    "unmanaged account was allowed",
  );
});

Deno.test("invalid credentials return generic error", async () => {
  const fetcher: typeof fetch = async () =>
    new Response("bad", { status: 400 });

  const req = new Request(
    "https://prooflab.co.in/api/auth/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "student@example.test",
        password: "wrong",
      }),
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    fetcher,
    now: () => NOW,
    createSession: async () => {
      throw new Error("must not store failed login");
    },
  });

  assert(res !== null, "login route not handled");
  assert(res.status === 401, "wrong invalid-login status");

  const body = await res.json();

  assert(
    body.error === "Invalid login credentials",
    "login disclosed provider error",
  );
});

Deno.test("session endpoint exposes identity but never credentials", async () => {
  const req = new Request(
    "https://prooflab.co.in/api/auth/session",
    {
      headers: {
        Cookie: makeSessionCookie(SESSION_ID, 3600).split(";")[0],
      },
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    now: () => NOW,
    loadSession: async () => stored(),
  });

  assert(res !== null, "session route not handled");
  assert(res.status === 200, "session lookup failed");

  const body = await res.json();
  const text = JSON.stringify(body);

  assert(body.session.user.id === USER_ID, "wrong session user");
  assert(!text.includes("SERVER_ONLY_REFRESH_TOKEN"), "refresh token leaked");
  assert(!text.includes("SERVER_ONLY_APP_TOKEN"), "app token leaked");
});

Deno.test("session endpoint refreshes expiring credentials server-side", async () => {
  const state: { updated: PrivateSession | null } = {
    updated: null,
  };

  const fetcher: typeof fetch = async (input) => {
    const url = String(input);

    if (url.includes("securetoken.googleapis.com")) {
      return Response.json({
        id_token: "NEW_GOOGLE_ID_TOKEN",
        refresh_token: "NEW_REFRESH_TOKEN",
      });
    }

    if (url === "https://bridge.example.test/token") {
      return Response.json({
        access_token: jwt({
          sub: USER_ID,
          role: "authenticated",
          email_confirmed: true,
        }),
        expires_in: 3600,
      });
    }

    throw new Error(`unexpected URL: ${url}`);
  };

  const req = new Request(
    "https://prooflab.co.in/api/auth/session",
    {
      headers: {
        Cookie: makeSessionCookie(SESSION_ID, 3600).split(";")[0],
      },
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    fetcher,
    now: () => NOW,
    loadSession: async () => stored(NOW + 1000),
    updateSession: async (_id, session) => {
      state.updated = session;
    },
  });

  assert(res !== null, "session route not handled");
  assert(res.status === 200, "refresh failed");
  const updated = state.updated;

  assert(updated !== null, "refreshed session not stored");
  assert(
    updated.googleRefreshToken === "NEW_REFRESH_TOKEN",
    "new refresh token not stored server-side",
  );
});

Deno.test("missing session cookie means signed out", async () => {
  const req = new Request(
    "https://prooflab.co.in/api/auth/session",
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    now: () => NOW,
  });

  assert(res !== null, "session route not handled");
  assert(res.status === 200, "missing cookie should not fail");

  const body = await res.json();

  assert(body.session === null, "missing cookie accepted");
});

Deno.test("logout revokes server session and clears browser cookie", async () => {
  let revoked = "";

  const req = new Request(
    "https://prooflab.co.in/api/auth/logout",
    {
      method: "POST",
      headers: {
        Cookie: makeSessionCookie(SESSION_ID, 3600).split(";")[0],
      },
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    revokeSession: async (id) => {
      revoked = id;
    },
  });

  assert(res !== null, "logout route not handled");
  assert(res.status === 200, "logout failed");
  assert(revoked === SESSION_ID, "server session not revoked");

  const cookie = res.headers.get("Set-Cookie") ?? "";
  assert(cookie.includes("Max-Age=0"), "browser cookie not cleared");
});

Deno.test("password reset request hides whether the email exists", async () => {
  let target = "";
  let sent: Record<string, unknown> = {};

  const fetcher: typeof fetch = async (input, init) => {
    target = String(input);
    sent = JSON.parse(String(init?.body ?? "{}"));

    // Simulate EMAIL_NOT_FOUND. Browser must still receive success.
    return new Response(
      JSON.stringify({
        error: {
          message: "EMAIL_NOT_FOUND",
        },
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  const req = new Request(
    "https://prooflab.co.in/api/auth/password-reset/request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "student@example.test",
      }),
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    fetcher,
  });

  assert(res !== null, "reset request route not handled");
  assert(res.status === 200, "reset request leaked account existence");

  const body = await res.json();

  assert(body.ok === true, "generic reset success missing");

  assert(
    target.includes("accounts:sendOobCode"),
    "wrong Google reset endpoint",
  );

  assert(
    sent.requestType === "PASSWORD_RESET",
    "wrong OOB request type",
  );

  assert(
    sent.continueUrl ===
      "https://prooflab.co.in/reset-password",
    "reset redirect escaped app origin",
  );
});

Deno.test("password reset code can be verified without exposing credentials", async () => {
  let sent: Record<string, unknown> = {};

  const fetcher: typeof fetch = async (_input, init) => {
    sent = JSON.parse(String(init?.body ?? "{}"));

    return Response.json({
      email: "student@example.test",
      requestType: "PASSWORD_RESET",
    });
  };

  const req = new Request(
    "https://prooflab.co.in/api/auth/password-reset/verify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        oob_code: "RESET_CODE",
      }),
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    fetcher,
  });

  assert(res !== null, "reset verify route not handled");
  assert(res.status === 200, "valid reset code rejected");

  assert(
    sent.oobCode === "RESET_CODE",
    "reset code was not sent server-side",
  );

  const text = JSON.stringify(await res.json());

  assert(
    !text.includes("access_token"),
    "access token leaked",
  );

  assert(
    !text.includes("refresh_token"),
    "refresh token leaked",
  );
});

Deno.test("password reset completion sends new password only to Google server-side", async () => {
  let sent: Record<string, unknown> = {};

  const fetcher: typeof fetch = async (_input, init) => {
    sent = JSON.parse(String(init?.body ?? "{}"));

    return Response.json({
      email: "student@example.test",
      requestType: "PASSWORD_RESET",
    });
  };

  const req = new Request(
    "https://prooflab.co.in/api/auth/password-reset/complete",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        oob_code: "RESET_CODE",
        new_password: "NewPassword123!",
      }),
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    fetcher,
  });

  assert(res !== null, "reset completion route not handled");
  assert(res.status === 200, "password reset failed");

  assert(
    sent.oobCode === "RESET_CODE",
    "reset code lost",
  );

  assert(
    sent.newPassword === "NewPassword123!",
    "new password lost",
  );

  const body = await res.json();

  assert(body.ok === true, "reset completion missing success");
});

Deno.test("email verification code is confirmed server-side", async () => {
  let target = "";
  let sent: Record<string, unknown> = {};

  const fetcher: typeof fetch = async (input, init) => {
    target = String(input);
    sent = JSON.parse(String(init?.body ?? "{}"));

    return Response.json({
      email: "student@example.test",
      emailVerified: true,
    });
  };

  const req = new Request(
    "https://prooflab.co.in/api/auth/verify-email",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        oob_code: "VERIFY_CODE",
      }),
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    fetcher,
  });

  assert(res !== null, "verify-email route not handled");
  assert(res.status === 200, "verification failed");

  assert(
    target.includes("accounts:update"),
    "wrong Google verification endpoint",
  );

  assert(
    sent.oobCode === "VERIFY_CODE",
    "verification code lost",
  );

  const body = await res.json();

  assert(body.ok === true, "verification success missing");
});

Deno.test("public signup is disabled", async () => {
  let providerCalled = false;

  const req = new Request(
    "https://prooflab.co.in/api/auth/signup",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new@example.test",
        password: "StrongPassword123!",
        full_name: "New Student",
        account_type: "student",
      }),
    },
  );

  const res = await handleAuthRoute(req, {
    env: env(),
    fetcher: async () => {
      providerCalled = true;
      throw new Error(
        "disabled public signup reached identity provider",
      );
    },
  });

  assert(
    res !== null,
    "signup route not handled",
  );

  assert(
    res.status === 403,
    "public signup was not refused",
  );

  assert(
    providerCalled === false,
    "disabled signup contacted identity provider",
  );

  const body = await res.json();

  assert(
    String(body.error).includes(
      "managed by your college or platform administrator",
    ),
    "managed-account message missing",
  );
});

Deno.test("authenticated password update stays server-side", async () => {
  const finalState: {
    value: PrivateSession | null;
  } = {
    value: null,
  };

  let sawPassword = false;

  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);

    if (
      url.includes(
        "securetoken.googleapis.com",
      )
    ) {
      return Response.json({
        id_token: "ACTION_ID_TOKEN",
        refresh_token: "ACTION_REFRESH_TOKEN",
      });
    }

    if (
      url.includes(
        "accounts:update",
      )
    ) {
      const sent = JSON.parse(
        String(
          init?.body ?? "{}",
        ),
      );

      sawPassword = sent.password ===
        "NewPassword123!";

      assert(
        sent.idToken ===
          "ACTION_ID_TOKEN",
        "browser did not stay out of provider token flow",
      );

      return Response.json({
        idToken: "UPDATED_ID_TOKEN",
        refreshToken: "UPDATED_REFRESH_TOKEN",
      });
    }

    if (
      url ===
        "https://bridge.example.test/token"
    ) {
      return Response.json({
        access_token: jwt({
          sub: USER_ID,
          role: "authenticated",
          email_confirmed: true,
        }),
        expires_in: 3600,
      });
    }

    throw new Error(
      `unexpected URL: ${url}`,
    );
  };

  const req = new Request(
    "https://prooflab.co.in/api/auth/update",
    {
      method: "POST",
      headers: {
        Cookie: makeSessionCookie(
          SESSION_ID,
          3600,
        ).split(";")[0],
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password: "NewPassword123!",
      }),
    },
  );

  const res = await handleAuthRoute(
    req,
    {
      env: env(),
      fetcher,
      now: () => NOW,
      loadSession: async () => stored(),
      updateSession: async (_id, session) => {
        finalState.value = session;
      },
    },
  );

  assert(
    res !== null,
    "update route not handled",
  );

  assert(
    res.status === 200,
    "password update failed",
  );

  assert(
    sawPassword,
    "new password never reached Google",
  );

  assert(
    finalState.value !== null,
    "updated secure session not stored",
  );

  const finalSession = finalState.value;

  assert(
    finalSession.googleRefreshToken ===
      "UPDATED_REFRESH_TOKEN",
    "rotated refresh token not stored server-side",
  );

  const text = JSON.stringify(
    await res.json(),
  );

  assert(
    !text.includes(
      "UPDATED_REFRESH_TOKEN",
    ),
    "refresh token leaked to browser",
  );

  assert(
    !text.includes(
      "UPDATED_ID_TOKEN",
    ),
    "provider token leaked to browser",
  );
});

Deno.test("verification resend uses the server session and returns no token", async () => {
  let sawVerification = false;

  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);

    if (
      url.includes(
        "securetoken.googleapis.com",
      )
    ) {
      return Response.json({
        id_token: "ACTION_ID_TOKEN",
        refresh_token: "ACTION_REFRESH_TOKEN",
      });
    }

    if (
      url ===
        "https://bridge.example.test/token"
    ) {
      return Response.json({
        access_token: jwt({
          sub: USER_ID,
          role: "authenticated",
          email_confirmed: false,
        }),
        expires_in: 3600,
      });
    }

    if (
      url.includes(
        "accounts:sendOobCode",
      )
    ) {
      const sent = JSON.parse(
        String(
          init?.body ?? "{}",
        ),
      );

      sawVerification = sent.requestType ===
          "VERIFY_EMAIL" &&
        sent.idToken ===
          "ACTION_ID_TOKEN";

      return Response.json({
        email: "student@example.test",
      });
    }

    throw new Error(
      `unexpected URL: ${url}`,
    );
  };

  const req = new Request(
    "https://prooflab.co.in/api/auth/resend-verification",
    {
      method: "POST",
      headers: {
        Cookie: makeSessionCookie(
          SESSION_ID,
          3600,
        ).split(";")[0],
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_type: "student",
      }),
    },
  );

  const res = await handleAuthRoute(
    req,
    {
      env: env(),
      fetcher,
      now: () => NOW,
      loadSession: async () => stored(),
      updateSession: async () => {},
    },
  );

  assert(
    res !== null,
    "resend route not handled",
  );

  assert(
    res.status === 200,
    "verification resend failed",
  );

  assert(
    sawVerification,
    "verification request was not server-side",
  );

  const text = JSON.stringify(
    await res.json(),
  );

  assert(
    !text.includes(
      "ACTION_ID_TOKEN",
    ),
    "provider token leaked",
  );

  assert(
    !text.includes(
      "ACTION_REFRESH_TOKEN",
    ),
    "refresh token leaked",
  );
});
