import {
  createSessionRecord,
  loadSessionRecord,
  revokeSessionRecord,
  updateSessionRecord,
} from "./sessionStore.ts";
import {
  generateSessionId,
  type PrivateSession,
  sealSession,
} from "./session.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const NOW = 1_800_000_000_000;

function key(): string {
  const bytes = new Uint8Array(32);
  bytes.fill(11);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function env() {
  const values: Record<string, string> = {
    POSTGREST_URL: "https://db.example.test",
    SESSION_KEY: key(),
  };

  return {
    get(name: string) {
      return values[name];
    },
  };
}

function sample(): PrivateSession {
  return {
    v: 1,
    googleRefreshToken: "TEST_GOOGLE_REFRESH_SECRET",
    appAccessToken: "TEST_APP_ACCESS_SECRET",
    appAccessExpiresAt: NOW + 3_600_000,
    expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "student@example.test",
      email_confirmed_at: "2026-10-07T00:00:00.000Z",
      role: "authenticated",
      user_metadata: {
        full_name: "Test Student",
      },
    },
  };
}

Deno.test("create stores only hash plus encrypted credentials", async () => {
  const rawSessionId = generateSessionId();
  let capturedUrl = "";
  let capturedBody = "";

  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? "");

    return new Response(null, { status: 201 });
  };

  await createSessionRecord(rawSessionId, sample(), {
    env: env(),
    fetcher,
    serviceToken: async () => "SERVICE_TOKEN",
    now: () => NOW,
  });

  assert(capturedUrl.endsWith("/web_sessions"), "wrong create URL");
  assert(
    !capturedBody.includes(rawSessionId),
    "raw browser session id leaked into database body",
  );
  assert(
    !capturedBody.includes("TEST_GOOGLE_REFRESH_SECRET"),
    "Google refresh token leaked in plaintext",
  );
  assert(
    !capturedBody.includes("TEST_APP_ACCESS_SECRET"),
    "application token leaked in plaintext",
  );

  const body = JSON.parse(capturedBody);

  assert(
    typeof body.session_hash === "string" &&
      /^[0-9a-f]{64}$/.test(body.session_hash),
    "session hash is not SHA-256 hex",
  );

  assert(
    typeof body.encrypted_payload === "string" &&
      body.encrypted_payload.startsWith("v1."),
    "encrypted session payload missing",
  );
});

Deno.test("load decrypts an active stored session", async () => {
  const rawSessionId = generateSessionId();
  const sealed = await sealSession(sample(), key());

  const fetcher: typeof fetch = async () => {
    return Response.json([
      {
        encrypted_payload: sealed,
        expires_at: new Date(sample().expiresAt).toISOString(),
        revoked_at: null,
      },
    ]);
  };

  const loaded = await loadSessionRecord(rawSessionId, {
    env: env(),
    fetcher,
    serviceToken: async () => "SERVICE_TOKEN",
    now: () => NOW,
  });

  assert(loaded !== null, "active session was not loaded");
  assert(loaded.user.id === sample().user.id, "wrong session user");
  assert(
    loaded.googleRefreshToken === sample().googleRefreshToken,
    "refresh token did not decrypt",
  );
});

Deno.test("load treats missing session as signed out", async () => {
  const fetcher: typeof fetch = async () => Response.json([]);

  const loaded = await loadSessionRecord(generateSessionId(), {
    env: env(),
    fetcher,
    serviceToken: async () => "SERVICE_TOKEN",
    now: () => NOW,
  });

  assert(loaded === null, "missing session was accepted");
});

Deno.test("load rejects expired encrypted session", async () => {
  const expired = sample();
  expired.expiresAt = NOW - 1;

  const sealed = await sealSession(expired, key());

  const fetcher: typeof fetch = async () =>
    Response.json([
      {
        encrypted_payload: sealed,
        expires_at: new Date(expired.expiresAt).toISOString(),
        revoked_at: null,
      },
    ]);

  const loaded = await loadSessionRecord(generateSessionId(), {
    env: env(),
    fetcher,
    serviceToken: async () => "SERVICE_TOKEN",
    now: () => NOW,
  });

  assert(loaded === null, "expired session was accepted");
});

Deno.test("update addresses row by hash, never raw session id", async () => {
  const rawSessionId = generateSessionId();
  let capturedUrl = "";
  let capturedBody = "";

  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? "");
    return new Response(null, { status: 204 });
  };

  await updateSessionRecord(rawSessionId, sample(), {
    env: env(),
    fetcher,
    serviceToken: async () => "SERVICE_TOKEN",
    now: () => NOW,
  });

  assert(
    !capturedUrl.includes(rawSessionId),
    "raw browser session id leaked into update URL",
  );
  assert(
    capturedUrl.includes("session_hash=eq."),
    "hashed session filter missing",
  );
  assert(
    !capturedBody.includes("TEST_GOOGLE_REFRESH_SECRET"),
    "refresh token leaked during update",
  );
});

Deno.test("logout revokes stored session", async () => {
  let capturedMethod = "";
  let capturedBody = "";

  const fetcher: typeof fetch = async (_input, init) => {
    capturedMethod = init?.method ?? "";
    capturedBody = String(init?.body ?? "");
    return new Response(null, { status: 204 });
  };

  await revokeSessionRecord(generateSessionId(), {
    env: env(),
    fetcher,
    serviceToken: async () => "SERVICE_TOKEN",
    now: () => NOW,
  });

  assert(capturedMethod === "PATCH", "logout did not PATCH session row");

  const body = JSON.parse(capturedBody);

  assert(
    typeof body.revoked_at === "string" && body.revoked_at.length > 0,
    "logout did not set revoked_at",
  );
});

Deno.test("database failure fails closed", async () => {
  const fetcher: typeof fetch = async () => new Response("no", { status: 503 });

  let failed = false;

  try {
    await loadSessionRecord(generateSessionId(), {
      env: env(),
      fetcher,
      serviceToken: async () => "SERVICE_TOKEN",
      now: () => NOW,
    });
  } catch {
    failed = true;
  }

  assert(failed, "session database failure was ignored");
});
