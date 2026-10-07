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
