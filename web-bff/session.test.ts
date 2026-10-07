import {
  COOKIE_NAME,
  clearSessionCookie,
  makeSessionCookie,
  readSessionCookie,
  sealSession,
  type PrivateSession,
  unsealSession,
} from "./session.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function testKey(): string {
  const bytes = new Uint8Array(32);
  bytes.fill(7);

  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const NOW = 1_800_000_000_000;

function sample(): PrivateSession {
  return {
    v: 1,
    googleRefreshToken: "TEST_REFRESH_TOKEN_NOT_REAL",
    appAccessToken: "TEST_APP_TOKEN_NOT_REAL",
    appAccessExpiresAt: NOW + 60 * 60 * 1000,
    expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "student@example.test",
      email_confirmed_at: "2026-10-07T00:00:00.000Z",
      role: "authenticated",
      user_metadata: { full_name: "Test Student" },
    },
  };
}

Deno.test("session encrypts and decrypts", async () => {
  const sealed = await sealSession(sample(), testKey());

  assert(!sealed.includes("TEST_REFRESH_TOKEN_NOT_REAL"), "refresh token leaked");
  assert(!sealed.includes("TEST_APP_TOKEN_NOT_REAL"), "app token leaked");

  const opened = await unsealSession(sealed, testKey(), NOW);

  assert(opened !== null, "session did not decrypt");
  assert(opened.user.id === sample().user.id, "wrong user");
  assert(
    opened.googleRefreshToken === sample().googleRefreshToken,
    "wrong refresh token",
  );
});

Deno.test("tampered session is rejected", async () => {
  const sealed = await sealSession(sample(), testKey());

  const last = sealed.at(-1)!;
  const replacement = last === "A" ? "B" : "A";
  const tampered = sealed.slice(0, -1) + replacement;

  const opened = await unsealSession(tampered, testKey(), NOW);

  assert(opened === null, "tampered cookie was accepted");
});

Deno.test("expired session is rejected", async () => {
  const sealed = await sealSession(sample(), testKey());

  const opened = await unsealSession(
    sealed,
    testKey(),
    sample().expiresAt + 1,
  );

  assert(opened === null, "expired cookie was accepted");
});

Deno.test("cookie is HttpOnly Secure and Strict", async () => {
  const sealed = await sealSession(sample(), testKey());
  const cookie = makeSessionCookie(sealed, 3600);

  assert(cookie.startsWith(`${COOKIE_NAME}=`), "wrong cookie name");
  assert(cookie.includes("HttpOnly"), "HttpOnly missing");
  assert(cookie.includes("Secure"), "Secure missing");
  assert(cookie.includes("SameSite=Strict"), "SameSite missing");
  assert(cookie.includes("Path=/"), "host cookie path wrong");

  const req = new Request("https://prooflab.co.in/api/auth/session", {
    headers: { Cookie: cookie.split(";")[0] },
  });

  assert(readSessionCookie(req) === sealed, "cookie could not be read server-side");

  const cleared = clearSessionCookie();
  assert(cleared.includes("Max-Age=0"), "clear cookie does not expire");
});

Deno.test("bad session key is refused", async () => {
  let refused = false;

  try {
    await sealSession(sample(), "not-a-32-byte-key");
  } catch {
    refused = true;
  }

  assert(refused, "invalid SESSION_KEY was accepted");
});
