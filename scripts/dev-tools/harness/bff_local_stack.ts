// LOCAL ONLY. The REAL web BFF code (web-bff/authRoutes.ts, proxyRoutes.ts, requestGuard.ts,
// session.ts, sessionStore.ts) served on one local origin together with the built website, with
// everything BEHIND the BFF replaced by an in-memory fake: Google Identity, the auth bridge,
// PostgREST (including the web_sessions table) and the functions service.
//
//   npm run build
//   deno run --no-lock --allow-net=127.0.0.1,localhost --allow-read=dist scripts/dev-tools/harness/bff_local_stack.ts
//   node scripts/dev-tools/bff_cookie_session_e2e.mjs
//
// REAL here: login / session / logout routes, the HttpOnly cookie, AES-GCM sealing of the stored
// session, "one session per account", the cross-site write guard, the proxy's path rules, and the
// fact that the browser never holds a token (the BFF attaches it).
// FAKE here: passwords, Google, the bridge's tokens (unsigned), and every database rule. The
// database permission answers below (403 for the wrong role) are a stand-in so the SCREENS can be
// tested; they prove nothing about the real row-level security.
//
// It listens on 127.0.0.1 only, makes no outbound request, and reads no secret. The session key is
// random per run. The accounts and passwords below are made up and exist nowhere else.
import { handleAuthRoute } from "../../../web-bff/authRoutes.ts";
import { handleProxyRoute } from "../../../web-bff/proxyRoutes.ts";
import { rejectCrossSiteBrowserWrite } from "../../../web-bff/requestGuard.ts";

const PORT = Number(Deno.args[0] ?? "5197");
const ORIGIN = `http://localhost:${PORT}`;
// Extra browser origins that may write (a local dev server that proxies /api here), comma separated.
const TRUSTED = [ORIGIN, ...(Deno.args[1] ?? "").split(",").map((o) => o.trim()).filter(Boolean)];
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const text64 = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

const env = new Map<string, string>(Object.entries({
  GOOGLE_API_KEY: "local-test-key",
  AUTH_BRIDGE_URL: "http://bridge.local",
  POSTGREST_URL: "http://db.local",
  FUNCTIONS_URL: "http://functions.local",
  FILES_URL: "http://files.local",
  ACCOUNTS_URL: "http://accounts.local",
  TRANSCRIBER_URL: "http://transcriber.local",
  SESSION_KEY: b64url(crypto.getRandomValues(new Uint8Array(32))),
  ENVIRONMENT: "development",
}));

type Account = { id: string; email: string; password: string; role: string | null; allowed: boolean; reason?: string; name: string; college?: string };
const uid = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
const COLLEGE = "cccccccc-0000-4000-8000-000000000001";
const accounts: Account[] = [
  { id: uid(1), email: "admin@local.test", password: "local-admin-pw", role: "admin", allowed: true, name: "Local Admin" },
  { id: uid(2), email: "college@local.test", password: "local-college-pw", role: "college_admin", allowed: true, name: "Local College" },
  { id: uid(3), email: "student@local.test", password: "local-student-pw", role: "student", allowed: true, name: "Local Student", college: COLLEGE },
  { id: uid(4), email: "company@local.test", password: "local-company-pw", role: "startup", allowed: true, name: "Local Company" },
  { id: uid(5), email: "norole@local.test", password: "local-norole-pw", role: null, allowed: false, reason: "account_not_provisioned", name: "No Role" },
  { id: uid(7), email: "student2@local.test", password: "local-student2-pw", role: "student", allowed: true, name: "Second Student", college: COLLEGE },
  { id: uid(6), email: "suspended@local.test", password: "local-suspended-pw", role: "college_admin", allowed: false, reason: "college_account_unavailable", name: "Suspended College" },
];
const byId = (id: string) => accounts.find((a) => a.id === id);
const sessions = new Map<string, Record<string, unknown>>(); // session_hash -> row
const clock = { offset: 0 };          // test control: move the BFF's clock forward
const outage = { accountRule: false }; // test control: web_login_identity cannot be asked
const log: { method: string; path: string; sub: string | null; role: string | null }[] = [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const appToken = (a: Account) => `${text64({ alg: "none" })}.${text64({ sub: a.id, role: "authenticated", email: a.email, email_confirmed: true })}.local`;
function subOf(headers: Headers): string | null {
  try {
    const part = (headers.get("Authorization") ?? "").replace("Bearer ", "").split(".")[1];
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))).sub ?? null;
  } catch {
    return null;
  }
}

/** Everything the BFF talks to. Nothing here leaves the process. */
const upstream = (async (input: Request | URL | string, init: RequestInit = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const raw = init.body == null ? "" : typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : await new Response(init.body as BodyInit).text();
  const body = () => { try { return JSON.parse(raw || "{}"); } catch { return {}; } };

  // Google Identity (fake)
  if (url.hostname === "identitytoolkit.googleapis.com" && url.pathname.endsWith("accounts:signInWithPassword")) {
    const { email, password } = body();
    const a = accounts.find((x) => x.email === String(email).toLowerCase() && x.password === password);
    if (!a) return json({ error: { message: "INVALID_LOGIN_CREDENTIALS" } }, 400);
    return json({ idToken: `google-id.${a.id}`, refreshToken: `google-refresh.${a.id}`, email: a.email });
  }
  if (url.hostname === "securetoken.googleapis.com") {
    const id = new URLSearchParams(raw).get("refresh_token")?.split(".")[1] ?? "";
    return byId(id) ? json({ id_token: `google-id.${id}`, refresh_token: `google-refresh.${id}` }) : json({}, 400);
  }
  if (url.hostname === "identitytoolkit.googleapis.com") return json({});
  if (url.hostname === "metadata.google.internal") return new Response("local-metadata-identity");

  // Auth bridge (fake, unsigned tokens)
  if (url.hostname === "bridge.local" && url.pathname === "/service-token") return json({ access_token: "local-service-token", token_type: "bearer", expires_in: 300 });
  if (url.hostname === "bridge.local" && url.pathname === "/token") {
    const a = byId((headers.get("Authorization") ?? "").split(".")[1] ?? "");
    return a ? json({ access_token: appToken(a), token_type: "bearer", expires_in: 3600 }) : json({ error: "invalid token" }, 401);
  }

  // PostgREST (fake)
  if (url.hostname === "db.local") {
    const path = url.pathname;
    const service = headers.get("Authorization") === "Bearer local-service-token";
    const sub = service ? null : subOf(headers);
    const me = sub ? byId(sub) : undefined;
    const one = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
    const none = () => (one ? json({ code: "PGRST116", message: "no rows" }, 406) : json([]));

    if (service && path === "/rpc/web_login_identity") {
      if (outage.accountRule) return json({ message: "upstream unavailable" }, 503);
      const a = byId(body()._user_id);
      if (!a || !a.allowed) return json({ allowed: false, reason: a?.reason ?? "account_not_provisioned" });
      return json({ allowed: true, role: a.role, full_name: a.name, account_type: a.role, has_completed_wizard: true, college_id: a.college ?? null, onboarding_status: a.role === "student" ? "active" : null });
    }
    if (service && path === "/rpc/web_replace_session") {
      const b = body();
      for (const row of sessions.values()) if (row.user_id === b._user_id && !row.revoked_at) row.revoked_at = b._created_at; // one session per account
      sessions.set(b._session_hash, { session_hash: b._session_hash, user_id: b._user_id, encrypted_payload: b._encrypted_payload, expires_at: b._expires_at, revoked_at: null });
      return new Response(null, { status: 204 });
    }
    if (service && path === "/web_sessions") {
      const hash = (url.searchParams.get("session_hash") ?? "").replace("eq.", "");
      const row = sessions.get(hash);
      if (method === "GET") return json(row && !row.revoked_at ? [row] : []);
      if (method === "PATCH" && row) Object.assign(row, body());
      return new Response(null, { status: 204 });
    }
    if (service) return json({ message: "unexpected service call" }, 500);

    log.push({ method, path, sub, role: me?.role ?? null });
    if (!me) return json({ message: "JWT missing or unknown" }, 401);
    if (path === "/user_roles") {
      if (method !== "GET") return json({ message: "new row violates row-level security policy" }, 403);
      const row = me.role ? { role: me.role, has_completed_wizard: true } : null;
      return row ? json(one ? row : [row]) : none();
    }
    if (path === "/student_profiles" && method === "GET" && me.role === "student") {
      const row = { id: me.id, user_id: me.id, full_name: me.name, college_id: me.college, status: "active", onboarding_status: "active" };
      return json(one ? row : [row]);
    }
    // STAND-IN permission rule, by function-name prefix. Not the real database rule.
    const fn = path.startsWith("/rpc/") ? path.slice(5) : "";
    const owner = fn.startsWith("admin_") ? "admin" : fn.startsWith("tpo_") ? "college_admin" : /^(recruiter_|company_)/.test(fn) ? "startup" : null;
    if (owner && me.role !== owner) return json({ message: "permission denied (local stand-in rule)" }, 403);
    if (fn) return json([]);
    if (method === "GET" || method === "HEAD") return none();
    return json([], 201);
  }
  if (url.hostname === "functions.local") {
    log.push({ method, path: `functions:${url.pathname}`, sub: subOf(headers), role: byId(subOf(headers) ?? "")?.role ?? null });
    return json({});
  }
  return json({ error: "not found (local fake)" }, 404);
}) as typeof fetch;

const deps = { env, fetcher: upstream, now: () => Date.now() + clock.offset };
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", json: "application/json", woff2: "font/woff2", txt: "text/plain", webp: "image/webp", jpg: "image/jpeg" };

async function staticFile(pathname: string): Promise<Response> {
  const clean = decodeURIComponent(pathname).replace(/\.\.+/g, "");
  for (const candidate of [`dist${clean}`, "dist/index.html"]) {
    try {
      if (candidate.endsWith("/")) continue;
      const data = await Deno.readFile(candidate);
      return new Response(data, { headers: { "Content-Type": TYPES[candidate.split(".").pop() ?? ""] ?? "application/octet-stream" } });
    } catch {
      // try the next one (single-page app fallback)
    }
  }
  return new Response("run `npm run build` first", { status: 500 });
}

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);

  // Test controls (local only): what reached the database, and server-side revocation.
  if (url.pathname === "/__test/log") return json(log);
  if (url.pathname === "/__test/sessions") return json([...sessions.values()].map((s) => ({ user_id: s.user_id, revoked: Boolean(s.revoked_at), payload_is_sealed: !String(s.encrypted_payload).includes("google-refresh") })));
  if (url.pathname === "/__test/revoke" && req.method === "POST") {
    const { email } = await req.json();
    const a = accounts.find((x) => x.email === email);
    for (const row of sessions.values()) if (a && row.user_id === a.id) row.revoked_at = new Date().toISOString();
    return json({ ok: true });
  }

  // Change an account AFTER sign-in, the way an administrator would. Does NOT touch the session
  // row: that is the case the BFF's own re-check has to catch. ("/__test/revoke" is the trigger case.)
  if (url.pathname === "/__test/account" && req.method === "POST") {
    const { email, allowed, role, reason } = await req.json();
    const a = accounts.find((x) => x.email === email);
    if (a) Object.assign(a, { allowed, reason: reason ?? a.reason }, role === undefined ? {} : { role });
    return json({ ok: Boolean(a) });
  }
  if (url.pathname === "/__test/advance" && req.method === "POST") {
    clock.offset += Number((await req.json()).ms) || 0;
    return json({ offset: clock.offset });
  }
  if (url.pathname === "/__test/outage" && req.method === "POST") {
    outage.accountRule = Boolean((await req.json()).on);
    return json(outage);
  }

  if (url.pathname.startsWith("/api/")) {
    const refused = rejectCrossSiteBrowserWrite(req, TRUSTED);
    if (refused) return refused;
    return (await handleAuthRoute(req, deps)) ?? (await handleProxyRoute(req, { env, fetcher: upstream, auth: deps })) ?? json({ error: "not found" }, 404);
  }
  return await staticFile(url.pathname);
});
console.log(`local BFF stack on ${ORIGIN} (real BFF code, fake upstreams)`);
