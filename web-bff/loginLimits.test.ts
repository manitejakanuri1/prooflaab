// MF-006 / MF-007 / MF-034: the login server limits wrong-password tries and writes every result itself.
import { clientAddress, handleAuthRoute } from "./authRoutes.ts";
import type { SecurityEvent } from "./sessionStore.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const USER_ID = "00000000-0000-0000-0000-000000000001";
const env = { get: (n: string) => ({ GOOGLE_API_KEY: "K", AUTH_BRIDGE_URL: "https://bridge.example.test" } as Record<string, string>)[n] };
const jwt = (claims: Record<string, unknown>) =>
  `x.${btoa(JSON.stringify(claims)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.y`;

/** A stand-in for web_login_gate: 5 server-logged wrong tries for one email lock it. */
function world(rightPassword = "right") {
  const events: SecurityEvent[] = [];
  let googleCalls = 0;
  const deps = {
    env,
    now: () => 1_800_000_000_000,
    newSessionId: () => "A".repeat(43),
    checkLoginGate: async (email: string) => {
      const wrong = events.filter((e) => e.event_type === "login_failed" && e.email === email).length;
      return wrong >= 5 ? { allowed: false, reason: "account_locked", retry_after: 900 } : { allowed: true };
    },
    logSecurityEvent: async (e: SecurityEvent) => { events.push(e); },
    loadLoginIdentity: async () => ({ allowed: true, role: "student" }),
    createSession: async () => {},
    fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("signInWithPassword")) {
        googleCalls++;
        const { password } = JSON.parse(String(init?.body));
        return password === rightPassword
          ? Response.json({ email: "s@example.test", idToken: "ID", refreshToken: "R" })
          : Response.json({ error: { message: "INVALID_LOGIN_CREDENTIALS" } }, { status: 400 });
      }
      if (url === "https://bridge.example.test/token") {
        return Response.json({ access_token: jwt({ sub: USER_ID, email_confirmed: true }), expires_in: 3600 });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch,
  };
  const login = (password: string, email = "S@Example.test") =>
    handleAuthRoute(new Request("https://prooflab-staging.web.app/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "6.6.6.6, 203.0.113.7, 35.191.0.1" },
      body: JSON.stringify({ email, password }),
    }), deps) as Promise<Response>;
  return { events, login, googleCalls: () => googleCalls };
}

Deno.test("5 wrong passwords answer 401; the 6th answers 429 with Retry-After and is never sent to Google", async () => {
  const w = world();
  for (let i = 0; i < 5; i++) assert((await w.login("nope")).status === 401, `try ${i + 1} not 401`);
  const sixth = await w.login("nope");
  assert(sixth.status === 429, `6th try answered ${sixth.status}`);
  assert(sixth.headers.get("Retry-After") === "900", `Retry-After ${sixth.headers.get("Retry-After")}`);
  assert(/Too many tries/.test((await sixth.json()).error), "no plain message");
  assert(w.googleCalls() === 5, `Google asked ${w.googleCalls()} times`);
});

Deno.test("while locked, even the right password is refused", async () => {
  const w = world();
  for (let i = 0; i < 5; i++) await w.login("nope");
  const res = await w.login("right");
  assert(res.status === 429, `right password during lock answered ${res.status}`);
  assert(res.headers.get("Set-Cookie") === null, "a session was started during the lock");
});

Deno.test("every result is written by the server with a real reason", async () => {
  const w = world();
  await w.login("nope");
  await w.login("right");
  for (let i = 0; i < 5; i++) await w.login("nope");
  const types = w.events.map((e) => `${e.event_type}:${e.detail?.reason}`);
  assert(types[0] === "login_failed:wrong_email_or_password", types[0]);
  assert(types[1] === "login_succeeded:signed_in", types[1]);
  assert(types.at(-1) === "login_rate_limited:account_locked", String(types.at(-1)));
  assert(w.events.every((e) => e.email === "s@example.test"), "email not normalised");
  assert(w.events.every((e) => e.ip === "203.0.113.7"), `ip ${w.events[0].ip}`);
  assert(w.events[1].user_id === USER_ID, "success not tied to the account");
});

Deno.test("if the limit check fails, sign-in is refused (fails closed) and Google is not asked", async () => {
  const w = world();
  let asked = false;
  const res = await handleAuthRoute(new Request("https://prooflab-staging.web.app/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "s@example.test", password: "right" }),
  }), {
    env,
    checkLoginGate: async () => { throw new Error("database down"); },
    logSecurityEvent: async () => {},
    fetcher: (async () => { asked = true; return new Response("{}"); }) as typeof fetch,
  });
  assert(res?.status === 503, `answered ${res?.status}`);
  assert(!asked, "the password went to Google without a limit check");
  void w;
});

Deno.test("a log write that fails does not change the answer", async () => {
  const w = world();
  const res = await handleAuthRoute(new Request("https://prooflab-staging.web.app/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "s@example.test", password: "nope" }),
  }), {
    env,
    checkLoginGate: async () => ({ allowed: true }),
    logSecurityEvent: async () => { throw new Error("log down"); },
    fetcher: (async () => Response.json({ error: { message: "INVALID_PASSWORD" } }, { status: 400 })) as typeof fetch,
  });
  assert(res?.status === 401, `answered ${res?.status}`);
  void w;
});

Deno.test("the address is read from the right, so a caller cannot choose it", () => {
  const at = (xff: string | null) =>
    clientAddress(new Request("https://x.test/", { headers: xff === null ? {} : { "x-forwarded-for": xff } }));
  assert(at("6.6.6.6, 203.0.113.7, 35.191.0.1") === "203.0.113.7", "spoofed left entry used");
  assert(at("203.0.113.7, 35.191.0.1") === "203.0.113.7", "two hops");
  assert(at("203.0.113.7") === "203.0.113.7", "one hop");
  assert(at(null) === "unknown", "no header");
});
