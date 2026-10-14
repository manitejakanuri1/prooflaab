// Browser regression test for REAL BFF cookie sessions. LOCAL ONLY.
//
//   npm run build
//   deno run --no-lock --allow-net=127.0.0.1,localhost --allow-read=dist scripts/dev-tools/harness/bff_local_stack.ts
//   node scripts/dev-tools/bff_cookie_session_e2e.mjs
//
// The browser talks to the real BFF code and the real production build of the website. Sign-in
// goes through the real form and the real /api/auth/login, and the browser ends up with the real
// HttpOnly session cookie. Nothing is planted in localStorage.
//
// REAL (proved here): cookie flags, no token in the browser, refresh keeps the session, logout
// revokes it on the server, one session per account, a server-side revocation ends the session,
// signed-out and wrong-role redirects, the cross-site write guard, public sign-up closed.
// FAKE (not proved here): Google, passwords, and every database permission rule - see
// harness/bff_local_stack.ts. Lines tagged [stand-in] depend on the fake database's rule.
import { chromium } from "playwright";

const APP = process.env.APP ?? "http://localhost:5197";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const HOME = { admin: "/admin/dashboard", college: "/college/dashboard", student: "/student/dashboard", company: "/company/dashboard" };
const LOGIN = {
  admin: ["admin@local.test", "local-admin-pw"],
  college: ["college@local.test", "local-college-pw"],
  student: ["student@local.test", "local-student-pw"],
  company: ["company@local.test", "local-company-pw"],
};
// A database function each OTHER role must not be able to call. [stand-in]
const FOREIGN_RPC = { admin: null, college: "admin_recruiters", student: "tpo_home", company: "admin_recruiters" };
const OWN_AREA = (role, path) => (role === "student" ? path.startsWith("/student/") : path === HOME[role]);

const browser = await chromium.launch();
const where = (page) => new URL(page.url()).pathname;
const settle = async (page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => !document.querySelector(".animate-spin"), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
};
const go = async (page, path) => {
  await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(page);
};
const api = async (page, path, init = {}) =>
  await page.evaluate(async ([p, i]) => {
    const r = await fetch(p, { credentials: "same-origin", ...i });
    let body = null;
    try { body = await r.json(); } catch { /* no body */ }
    return { status: r.status, body };
  }, [path, init]);
const stackLog = async () => await (await fetch(`${APP}/__test/log`)).json();

async function signIn(page, email, password) {
  await go(page, "/auth");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname !== "/auth" || document.querySelector('[role="alert"]'), null, { timeout: 30000 }).catch(() => {});
  await settle(page);
}

try {
  // 1. Signed out.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const home of Object.values(HOME)) {
      await go(page, home);
      check(`signed out: ${home} -> sign-in`, where(page) === "/auth", where(page));
    }
    check("signed out: database through the BFF is refused", [401, 403].includes((await api(page, "/api/db/user_roles?select=role")).status));
    check("signed out: functions through the BFF are refused", [401, 403].includes((await api(page, "/api/functions/run-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status));
    check("signed out: session endpoint says no session", (await api(page, "/api/auth/session")).body?.session == null);
    const signup = await api(page, "/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@local.test", password: "Local-pw-12345", full_name: "X", account_type: "college_admin" }) });
    check("public sign-up is closed (403)", signup.status === 403, String(signup.status));
    await go(page, "/signup-college");
    check("/signup-college is not a page (not-found)", /404|not found/i.test(await page.locator("body").innerText()));
    await go(page, "/");
    const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    check("landing page links to no sign-up address", !hrefs.some((h) => /signup/i.test(h ?? "")), hrefs.filter((h) => /signup/i.test(h ?? "")).join(","));
    await context.close();
  }

  // 2. Each role: real sign-in, cookie, refresh, boundaries, logout.
  for (const role of Object.keys(HOME)) {
    const [email, password] = LOGIN[role];
    const context = await browser.newContext();
    const page = await context.newPage();
    const browserAuthHeaders = [];
    page.on("request", (r) => { if (r.url().includes("/api/") && r.headers().authorization) browserAuthHeaders.push(r.url()); });

    await signIn(page, email, password);
    check(`${role}: sign-in lands in its own area`, OWN_AREA(role, where(page)), where(page));

    const cookie = (await context.cookies()).find((c) => c.name === "__session");
    check(`${role}: session cookie is HttpOnly, Secure, SameSite=Strict`, cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === "Strict", JSON.stringify(cookie && { httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite }));
    const seen = await page.evaluate(() => ({ cookie: document.cookie, storage: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) }));
    check(`${role}: page script cannot read the cookie`, !seen.cookie.includes("__session"));
    check(`${role}: no token in browser storage`, !/eyJ|google-refresh|google-id|access_token|refresh_token|prooflab\.auth/.test(seen.storage), seen.storage.slice(0, 120));
    const session = (await api(page, "/api/auth/session")).body?.session;
    check(`${role}: session endpoint returns the user and no token`, session?.user?.email === email && !/token/i.test(JSON.stringify(session)), JSON.stringify(Object.keys(session ?? {})));

    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page);
    check(`${role}: refresh keeps the session and the page`, OWN_AREA(role, where(page)), where(page));
    await go(page, "/");
    check(`${role}: opening the landing page sends a signed-in user to its own area`, OWN_AREA(role, where(page)), where(page));

    for (const [other, home] of Object.entries(HOME)) {
      if (other === role) continue;
      await go(page, home);
      check(`${role}: ${home} refused`, where(page) !== home, where(page));
    }
    const own = await api(page, "/api/db/user_roles?select=role");
    check(`${role}: reads its own role through the BFF`, own.status === 200 && JSON.stringify(own.body).includes("role"), String(own.status));
    const grant = await api(page, "/api/db/user_roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: session?.user?.id, role: "admin" }) });
    check(`${role}: cannot write a role row [stand-in]`, grant.status === 403, String(grant.status));
    if (FOREIGN_RPC[role]) {
      const foreign = await api(page, `/api/db/rpc/${FOREIGN_RPC[role]}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      check(`${role}: another role's database function is refused [stand-in]`, foreign.status === 403, `${FOREIGN_RPC[role]} -> ${foreign.status}`);
    }
    const escape = await api(page, "/api/db/..%2Fweb_sessions");
    check(`${role}: path tricks are refused by the BFF`, escape.status >= 400, String(escape.status));

    const seenByDb = (await stackLog()).filter((e) => e.sub === session?.user?.id);
    check(`${role}: the database saw this user's token, added by the BFF`, seenByDb.length > 0 && browserAuthHeaders.length === 0, `db calls ${seenByDb.length}, browser Authorization headers ${browserAuthHeaders.length}`);

    // Logout: server-side, cookie cleared, old cookie dead, Back does not reopen.
    await go(page, role === "student" ? "/student/start" : HOME[role]);
    const out = await api(page, "/api/auth/logout", { method: "POST" });
    check(`${role}: logout accepted`, out.status === 200, String(out.status));
    check(`${role}: cookie removed after logout`, !(await context.cookies()).some((c) => c.name === "__session" && c.value));
    await go(page, HOME[role]);
    check(`${role}: dashboard closed after logout`, where(page) === "/auth", where(page));
    await page.goBack().catch(() => {});
    await settle(page);
    check(`${role}: Back after logout does not reopen the dashboard`, !OWN_AREA(role, where(page)) || where(page) === "/auth", where(page));
    if (cookie) {
      await context.addCookies([{ name: cookie.name, value: cookie.value, domain: cookie.domain, path: "/", httpOnly: true, secure: true, sameSite: "Strict" }]);
      check(`${role}: the old cookie no longer works (revoked on the server)`, (await api(page, "/api/auth/session")).body?.session == null);
    }
    await context.close();
  }

  // 3. Refused sign-ins leave no session.
  for (const [label, email, password, expect] of [
    ["wrong password", "college@local.test", "not-the-password", /Invalid email or password/i],
    ["login with no role (account_not_provisioned)", "norole@local.test", "local-norole-pw", /managed by your college or platform administrator/i],
    ["suspended college", "suspended@local.test", "local-suspended-pw", /managed by your college or platform administrator/i],
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, email, password);
    const body = await page.locator("body").innerText();
    check(`${label}: stays on sign-in with the reason`, where(page) === "/auth" && expect.test(body), body.replace(/\s+/g, " ").slice(-140));
    check(`${label}: no session cookie`, !(await context.cookies()).some((c) => c.name === "__session" && c.value));
    await go(page, "/college/dashboard");
    check(`${label}: dashboard stays closed`, where(page) === "/auth", where(page));
    await context.close();
  }

  // 4. One session per account, and a server-side revocation.
  {
    const first = await browser.newContext();
    const a = await first.newPage();
    await signIn(a, ...LOGIN.college);
    const second = await browser.newContext();
    const b = await second.newPage();
    await signIn(b, ...LOGIN.college);
    check("second sign-in works", where(b) === HOME.college, where(b));
    await go(a, HOME.college);
    check("first browser is signed out by the second sign-in", where(a) === "/auth", where(a));

    await fetch(`${APP}/__test/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: LOGIN.college[0] }) });
    await go(b, HOME.college);
    check("session revoked on the server: next page load is signed out", where(b) === "/auth", where(b));
    const stored = await (await fetch(`${APP}/__test/sessions`)).json();
    check("stored sessions are sealed (no readable Google token)", stored.length > 0 && stored.every((s) => s.payload_is_sealed));
    await first.close();
    await second.close();
  }

  // 5. Cross-site write guard (sent from Node so the headers can be forged).
  {
    const evil = await fetch(`${APP}/api/auth/logout`, { method: "POST", headers: { Origin: "https://evil.example" } });
    check("write from another origin is refused", evil.status === 403, String(evil.status));
    const cross = await fetch(`${APP}/api/auth/login`, { method: "POST", headers: { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }, body: "{}" });
    check("cross-site write is refused", cross.status === 403, String(cross.status));
  }

  // 6. Suspended WHILE signed in. These move the stack's clock, so they run last.
  const control = async (path, body) => await fetch(`${APP}/__test/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const WINDOW = 30_000; // ACCOUNT_RECHECK_MS in web-bff/authRoutes.ts
  for (const [role, change] of [
    ["college", { allowed: false, reason: "college_account_unavailable" }],
    ["company", { allowed: false, reason: "company_account_unavailable" }],
    ["student", { allowed: false, role: null, reason: "account_not_provisioned" }], // role removed
  ]) {
    const [email, password] = LOGIN[role];
    const context = await browser.newContext();
    const tabA = await context.newPage();
    await signIn(tabA, email, password);
    const tabB = await context.newPage();
    await go(tabB, role === "student" ? "/student/start" : HOME[role]);
    check(`${role}: two tabs signed in`, OWN_AREA(role, where(tabA)) && OWN_AREA(role, where(tabB)), `${where(tabA)} / ${where(tabB)}`);

    await control("account", { email, ...change }); // an administrator acts; the session row is untouched
    await control("advance", { ms: WINDOW });
    const before = (await stackLog()).length;
    const inFlight = await Promise.all([
      api(tabA, "/api/db/user_roles?select=role"),
      api(tabA, "/api/functions/run-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
      api(tabB, "/api/db/student_profiles?select=id"),
      api(tabB, "/api/auth/session"),
    ]);
    check(`${role}: suspended while signed in - requests from both tabs are refused`, inFlight.slice(0, 3).every((r) => r.status === 401) && inFlight[3].body?.session == null, inFlight.map((r) => r.status).join(","));
    check(`${role}: nothing reached the database or functions after suspension`, (await stackLog()).length === before, `${(await stackLog()).length - before} calls`);
    check(`${role}: the cookie was cleared`, !(await context.cookies()).some((c) => c.name === "__session" && c.value));
    await go(tabB, HOME[role]);
    check(`${role}: other tab lands on sign-in`, where(tabB) === "/auth", where(tabB));
    await tabA.reload({ waitUntil: "domcontentloaded" });
    await settle(tabA);
    check(`${role}: first tab is signed out on reload`, where(tabA) === "/auth", where(tabA));
    await signIn(tabA, email, password);
    check(`${role}: cannot sign in again while suspended`, where(tabA) === "/auth", where(tabA));

    await control("account", { email, allowed: true, role: role === "student" ? "student" : undefined });
    await signIn(tabA, email, password);
    check(`${role}: restored account signs in again (old session did not come back by itself)`, OWN_AREA(role, where(tabA)), where(tabA));
    await context.close();
  }

  // 7. The account rule cannot be asked: fail closed, then recover without signing in again.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, ...LOGIN.admin);
    await control("outage", { on: true });
    await control("advance", { ms: WINDOW });
    const before = (await stackLog()).length;
    const closed = await api(page, "/api/db/user_roles?select=role");
    check("account rule unreachable: request answered 503", closed.status === 503, String(closed.status));
    check("account rule unreachable: nothing forwarded", (await stackLog()).length === before);
    check("account rule unreachable: the session is kept, not destroyed", (await context.cookies()).some((c) => c.name === "__session" && c.value));
    await control("outage", { on: false });
    check("account rule back: the same session works again", (await api(page, "/api/db/user_roles?select=role")).status === 200);

    // 8. Expired session.
    await control("advance", { ms: 8 * 24 * 60 * 60 * 1000 });
    check("expired session: request refused", (await api(page, "/api/db/user_roles?select=role")).status === 401);
    await go(page, HOME.admin);
    check("expired session: dashboard sends to sign-in", where(page) === "/auth", where(page));
    await context.close();
  }
} catch (e) {
  check(`(unexpected error) ${String(e.message).slice(0, 220)}`, false);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} failed (real BFF code and cookie; fake Google and database)`);
process.exit(failed ? 1 : 0);
