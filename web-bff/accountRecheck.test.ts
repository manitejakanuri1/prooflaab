// An account suspended, removed or re-roled AFTER sign-in must lose its open session.
// Every dependency is a stub; no network, no real account.
import {
  ACCOUNT_RECHECK_MS,
  handleAuthRoute,
  resetAccountRecheckCache,
} from "./authRoutes.ts";
import { handleProxyRoute } from "./proxyRoutes.ts";
import { makeSessionCookie, type PrivateSession } from "./session.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const START = 1_800_000_000_000;
const SESSION_ID = "C".repeat(43);
const cookie = () => makeSessionCookie(SESSION_ID, 3600).split(";")[0];

function sessionOf(role: string): PrivateSession {
  return {
    v: 1,
    googleRefreshToken: "SERVER_REFRESH",
    appAccessToken: "SERVER_APP_ACCESS",
    appAccessExpiresAt: START + 3_600_000,
    expiresAt: START + 7 * 24 * 60 * 60 * 1000,
    user: {
      id: "00000000-0000-0000-0000-0000000000c1",
      email: "tpo@example.test",
      email_confirmed_at: "2026-10-07T00:00:00.000Z",
      role: "authenticated",
      user_metadata: { account_type: role },
    },
  };
}

const env = () => {
  const values: Record<string, string> = {
    POSTGREST_URL: "https://db.example.test",
    FUNCTIONS_URL: "https://functions.example.test",
    FILES_URL: "https://files.example.test",
  };
  return { get: (name: string) => values[name] };
};

/** One signed-in account whose state the test changes while "signed in". */
function world(role = "college_admin") {
  const state = {
    now: START,
    account: { allowed: true, role } as { allowed: boolean; role?: string; reason?: string },
    checkFails: false,
    rowRevoked: false, // what the database trigger does
    checks: 0,
    revoked: 0,
    forwarded: [] as string[],
  };
  const auth = {
    env: env(),
    now: () => state.now,
    loadSession: async () => (state.rowRevoked ? null : sessionOf(role)),
    loadLoginIdentity: async () => {
      state.checks++;
      if (state.checkFails) throw new Error("database unreachable");
      return state.account;
    },
    revokeSession: async () => {
      state.revoked++;
      state.rowRevoked = true;
    },
  };
  const fetcher: typeof fetch = async (input) => {
    state.forwarded.push(String(input));
    return Response.json([{ id: 1 }]);
  };
  const call = async (path: string, method = "GET") =>
    (await handleProxyRoute(
      new Request(`https://prooflab.co.in${path}`, {
        method,
        headers: { Cookie: cookie(), "Content-Type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      }),
      { env: env(), fetcher, auth },
    ))!;
  const sessionEndpoint = async () =>
    (await handleAuthRoute(
      new Request("https://prooflab.co.in/api/auth/session", { headers: { Cookie: cookie() } }),
      auth,
    ))!;
  resetAccountRecheckCache();
  return { state, call, sessionEndpoint, auth };
}

Deno.test("still allowed: the request goes through with the server's token", async () => {
  const { state, call } = world();
  const res = await call("/api/db/colleges?select=id");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(Number(state.forwarded.length) === 1, "request was not forwarded");
  assert(Number(state.revoked) === 0, "a healthy session was revoked");
});

for (
  const [name, change] of [
    ["college suspended", { allowed: false, reason: "college_account_unavailable" }],
    ["company suspended", { allowed: false, reason: "company_account_unavailable" }],
    ["student suspended or removed from its college", { allowed: false, reason: "student_not_college_managed" }],
    ["role row removed", { allowed: false, reason: "account_not_provisioned" }],
    ["role changed to another role", { allowed: true, role: "student" }],
  ] as const
) {
  Deno.test(`signed in, then ${name}: next request 401, session revoked, nothing forwarded`, async () => {
    const { state, call, sessionEndpoint } = world();
    assert((await call("/api/db/colleges?select=id")).status === 200, "setup: first request should pass");

    state.account = { ...change };
    state.now += ACCOUNT_RECHECK_MS; // the remembered answer has aged out
    state.forwarded.length = 0;

    const res = await call("/api/db/colleges?select=id");
    assert(res.status === 401, `expected 401, got ${res.status}`);
    assert((res.headers.get("Set-Cookie") ?? "").includes("Max-Age=0"), "cookie was not cleared");
    assert(Number(state.revoked) === 1, "session row was not revoked");
    assert(Number(state.forwarded.length) === 0, "request reached the backend");

    // Every other door is closed too, and stays closed.
    assert((await call("/api/functions/run-code", "POST")).status === 401, "functions still open");
    assert((await call("/api/files/private/x.txt")).status === 401, "files still open");
    const body = await (await sessionEndpoint()).json();
    assert(body.session === null, "session endpoint still reports a session");
    assert(Number(state.forwarded.length) === 0, "something reached the backend after revocation");
  });
}

Deno.test("database revoked the session row (trigger): refused at once, inside the remembered window", async () => {
  const { state, call } = world();
  assert((await call("/api/db/colleges?select=id")).status === 200, "setup");
  const checksBefore = state.checks;

  state.rowRevoked = true; // migration 101's trigger fired; no time has passed
  state.forwarded.length = 0;

  const res = await call("/api/db/colleges?select=id");
  assert(res.status === 401, `expected 401, got ${res.status}`);
  assert(Number(state.forwarded.length) === 0, "request reached the backend");
  assert(Number(state.checks) === checksBefore, "the account rule was asked although the row was already gone");
});

Deno.test("several tabs and requests in flight: all refused once the account is suspended", async () => {
  const { state, call } = world();
  assert((await call("/api/db/colleges?select=id")).status === 200, "setup");

  state.account = { allowed: false, reason: "college_account_unavailable" };
  state.now += ACCOUNT_RECHECK_MS;
  state.forwarded.length = 0;

  const answers = await Promise.all([
    call("/api/db/colleges?select=id"),
    call("/api/db/rpc/tpo_home", "POST"),
    call("/api/functions/create-student-users", "POST"),
    call("/api/db/student_profiles?select=id"),
    call("/api/files/private/report.pdf"),
  ]);
  assert(answers.every((r) => r.status === 401), `statuses: ${answers.map((r) => r.status).join(",")}`);
  assert(Number(state.forwarded.length) === 0, `forwarded: ${state.forwarded.join(", ")}`);
});

Deno.test("the account rule cannot be asked: 503, nothing forwarded, not remembered, session kept", async () => {
  const { state, call, sessionEndpoint } = world();
  state.checkFails = true;

  const res = await call("/api/db/colleges?select=id");
  assert(res.status === 503, `expected 503, got ${res.status}`);
  assert(Number(state.forwarded.length) === 0, "request was forwarded without a check");
  assert(Number(state.revoked) === 0, "an outage must not sign people out for good");
  assert((await sessionEndpoint()).status === 503, "session endpoint should also fail closed");

  const checks = state.checks;
  assert((await call("/api/db/colleges?select=id")).status === 503, "second request should fail closed too");
  assert(Number(state.checks) === checks + 1, "the failure was remembered as a success");

  state.checkFails = false;
  assert((await call("/api/db/colleges?select=id")).status === 200, "recovers when the rule can be asked again");
});

Deno.test("an outage after a good check does not extend access past the window", async () => {
  const { state, call } = world();
  assert((await call("/api/db/colleges?select=id")).status === 200, "setup");

  state.checkFails = true;
  state.now += ACCOUNT_RECHECK_MS - 1;
  assert((await call("/api/db/colleges?select=id")).status === 200, "inside the window the remembered answer holds");
  state.now += 1;
  assert((await call("/api/db/colleges?select=id")).status === 503, "at the end of the window it must be asked again, and fail closed");
});

Deno.test("the account rule is asked once per window per session, not on every request", async () => {
  const { state, call } = world();
  for (let i = 0; i < 25; i++) assert((await call("/api/db/colleges?select=id")).status === 200, "request failed");
  assert(Number(state.checks) === 1, `asked ${state.checks} times for 25 requests`);

  state.now += ACCOUNT_RECHECK_MS;
  await call("/api/db/colleges?select=id");
  assert(Number(state.checks) === 2, "not asked again after the window");

  state.now -= 10 * ACCOUNT_RECHECK_MS; // clock moved backwards: do not trust the old answer
  await call("/api/db/colleges?select=id");
  assert(Number(state.checks) === 3, "a backwards clock kept the old answer alive");
});

Deno.test("logout always works, even for a suspended account or during an outage", async () => {
  const { state, auth } = world();
  state.account = { allowed: false, reason: "college_account_unavailable" };
  state.checkFails = true;

  const res = (await handleAuthRoute(
    new Request("https://prooflab.co.in/api/auth/logout", { method: "POST", headers: { Cookie: cookie() } }),
    auth,
  ))!;
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((res.headers.get("Set-Cookie") ?? "").includes("Max-Age=0"), "cookie was not cleared");
  assert(Number(state.revoked) === 1, "session row was not revoked");
});

Deno.test("a refused session is checked again if the same cookie is replayed", async () => {
  const { state, call } = world();
  state.account = { allowed: false, reason: "college_account_unavailable" };
  assert((await call("/api/db/colleges?select=id")).status === 401, "first");
  state.rowRevoked = false; // pretend the revoke did not stick
  assert((await call("/api/db/colleges?select=id")).status === 401, "a refusal must never be remembered as allowed");
  assert(Number(state.checks) === 2, "refusal was cached");
});
