// S40 fault injection: a Google Identity account is deleted or disabled AFTER sign-in (in the Console, or by the
// app). The gateway must refuse the open session, revoke it, forward nothing and fail closed on every Google
// error. Every dependency is a stub; no network, no real account. Runs for all four account types.
import { handleAuthRoute, resetAccountRecheckCache } from "./authRoutes.ts";
import { handleProxyRoute } from "./proxyRoutes.ts";
import { makeSessionCookie, type PrivateSession } from "./session.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const SESSION_ID = "D".repeat(43);
const USER_ID = "00000000-0000-0000-0000-0000000000d1";
const OTHER_ID = "00000000-0000-0000-0000-0000000000d2";
const cookie = () => makeSessionCookie(SESSION_ID, 3600).split(";")[0];

const env = () => {
  const values: Record<string, string> = {
    GOOGLE_API_KEY: "TEST_GOOGLE_KEY",
    AUTH_BRIDGE_URL: "https://bridge.example.test",
    POSTGREST_URL: "https://db.example.test",
    FUNCTIONS_URL: "https://functions.example.test",
    FILES_URL: "https://files.example.test",
  };
  return { get: (name: string) => values[name] };
};

function jwt(claims: Record<string, unknown>): string {
  const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(claims)}.signature`;
}

type Google =
  | "ok" | "USER_NOT_FOUND" | "USER_DISABLED" | "TOKEN_EXPIRED" | "network" | "malformed"
  | "bridge_refuses" | "other_subject";

/** One signed-in account. `google` decides what Google / the bridge answer when the session is refreshed. */
function world(role: string, google: Google, appExpiresIn = 2 * MIN) {
  const state = {
    now: NOW, google, revoked: 0, updated: 0, rowRevoked: false,
    forwarded: [] as string[], googleCalls: 0,
  };
  const session = (): PrivateSession => ({
    v: 1,
    googleRefreshToken: "SERVER_REFRESH",
    appAccessToken: "SERVER_APP_ACCESS",
    appAccessExpiresAt: NOW + appExpiresIn,
    expiresAt: NOW + 7 * 24 * 60 * MIN,
    user: {
      id: USER_ID, email: "someone@example.test", email_confirmed_at: "2026-10-07T00:00:00.000Z",
      role: "authenticated", user_metadata: { account_type: role },
    },
  });
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("securetoken.googleapis.com")) {
      state.googleCalls++;
      switch (state.google) {
        case "network": throw new TypeError("fetch failed");
        case "malformed": return Response.json({ id_token: 42 });
        case "USER_NOT_FOUND": case "USER_DISABLED": case "TOKEN_EXPIRED":
          return Response.json({ error: { code: 400, message: state.google } }, { status: 400 });
        default: return Response.json({ id_token: "NEW_ID_TOKEN", refresh_token: "NEW_REFRESH" });
      }
    }
    if (url === "https://bridge.example.test/token") {
      if (state.google === "bridge_refuses") return Response.json({ error: "not provisioned" }, { status: 403 });
      const sub = state.google === "other_subject" ? OTHER_ID : USER_ID;
      return Response.json({ access_token: jwt({ sub, role: "authenticated", email_confirmed: true }), expires_in: 3600 });
    }
    state.forwarded.push(url);
    return Response.json([{ id: 1 }]);
  };
  const auth = {
    env: env(),
    fetcher,
    now: () => state.now,
    loadSession: async () => (state.rowRevoked ? null : session()),
    loadLoginIdentity: async () => ({ allowed: true, role }),   // the database has not heard about it (yet)
    updateSession: async () => { state.updated++; },
    revokeSession: async () => { state.revoked++; state.rowRevoked = true; },
  };
  const sessionEndpoint = async () =>
    (await handleAuthRoute(new Request("https://prooflab.co.in/api/auth/session", { headers: { Cookie: cookie() } }), auth))!;
  const data = async (path = "/api/db/colleges?select=id") =>
    (await handleProxyRoute(new Request(`https://prooflab.co.in${path}`, { headers: { Cookie: cookie() } }),
      { env: env(), fetcher, auth }))!;
  resetAccountRecheckCache();
  return { state, sessionEndpoint, data };
}

const ROLES = ["student", "college_admin", "startup", "admin"];
const DENIALS: Google[] = ["USER_NOT_FOUND", "USER_DISABLED", "TOKEN_EXPIRED", "network", "malformed", "bridge_refuses"];

for (const role of ROLES) {
  for (const google of DENIALS) {
    Deno.test(`${role}: Google answers ${google} at refresh -> signed out, session revoked, nothing stored`, async () => {
      const { state, sessionEndpoint } = world(role, google);
      const res = await sessionEndpoint();
      const body = await res.json();
      assert(res.status === 200 && body.session === null, `expected signed out, got ${res.status} ${JSON.stringify(body)}`);
      assert(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(res.headers.get("Set-Cookie") ?? ""), "the browser cookie is cleared");
      assert(state.revoked === 1, "the stored session is revoked");
      assert(state.updated === 0, "nothing from the failed refresh is stored");
    });

    Deno.test(`${role}: Google answers ${google} at refresh -> a data request is refused and nothing is forwarded`, async () => {
      const { state, data } = world(role, google);
      const res = await data();
      assert(res.status === 401, `expected 401, got ${res.status}`);
      assert(state.forwarded.length === 0, `forwarded ${state.forwarded.join(",")}`);
      const again = await data();   // the same cookie replayed
      assert(again.status === 401 && state.forwarded.length === 0, "a replayed cookie stays refused");
    });
  }

  Deno.test(`${role}: refreshed token names a DIFFERENT account (id collision) -> refused, never swapped`, async () => {
    const { state, sessionEndpoint, data } = world(role, "other_subject");
    const res = await sessionEndpoint();
    assert((await res.json()).session === null, "a session never continues as another account");
    assert(state.revoked === 1 && state.updated === 0, "revoked, nothing stored");
    assert((await data()).status === 401 && state.forwarded.length === 0, "no request forwarded");
  });

  Deno.test(`${role}: healthy refresh keeps the session (control case for the tests above)`, async () => {
    const { state, sessionEndpoint } = world(role, "ok");
    const body = await (await sessionEndpoint()).json();
    assert(body.session?.user?.id === USER_ID, "still signed in");
    assert(state.revoked === 0 && state.updated === 1, "refreshed and stored");
  });
}

Deno.test("BOUND: a Google account deleted in the Console keeps a gateway session at most until the app token is due for refresh", async () => {
  // Measured property, not a wish: with only the token refresh to notice a Console deletion (the database learns of it
  // through the sync, students only, after its grace period), access ends once the app token is within the 5-minute
  // refresh margin. An app token lives one hour (bridge expires_in 3600), so the bound is about 55 minutes. The
  // identity-sync event (TEJA, pending) is meant to make this immediate; when it lands, tighten this test.
  const { state, data } = world("student", "USER_NOT_FOUND", 60 * MIN);
  assert((await data()).status === 200, "minute 0: the old token still works (Google is not asked yet)");
  state.now = NOW + 54 * MIN;
  assert((await data()).status === 200, "minute 54: still inside the token, still works");
  assert(state.googleCalls === 0, "Google was not asked yet");
  state.now = NOW + 56 * MIN;
  assert((await data()).status === 401, "minute 56: refresh is due, Google says the account is gone, refused");
  assert(state.revoked === 1, "and the session is revoked");
});
