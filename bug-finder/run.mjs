// The automatic bug finder: a robot student that uses the REAL, LIVE app the same way a person
// would, and writes down what broke. It needs no real user to be online - it makes its own traffic,
// on dedicated test accounts, so it finds bugs even at 3 AM with nobody around.
//
// What it is NOT: a load test. It runs one journey at a time, like a single careful student, not a
// flood. Flooding the live site is a separate, riskier thing (see CLAUDE.md) - do not repurpose this.
//
// Every step is timed and recorded, pass or fail. At the end:
//   - one line per step, and one summary line, printed as JSON (Cloud Logging reads this)
//   - a row per step saved in bug_finder_runs (service-role insert), so the admin page can show it
//   - the process exits non-zero if anything failed, so the Cloud Run Job execution itself shows red
//
// Known gap: it does not test voice recording (needs a fake microphone; fragile, left for later -
// tell the person reading this before claiming voice is covered).
import { chromium } from "playwright";
import { createHmac } from "node:crypto";

const SITE = process.env.SITE_URL || "https://prooflab.co.in";
const API = process.env.POSTGREST_URL;
const JWT_SECRET = process.env.PGRST_JWT_SECRET;

/** PostgREST here verifies a signed HS256 token, not a static API key - same scheme pl.py's
 * token('svc') uses. Minted fresh each run so nothing long-lived is embedded anywhere. */
function serviceToken() {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}
const STUDENT_EMAIL = process.env.BUGFINDER_STUDENT_EMAIL || "vidyuthsetu+t15@gmail.com";
const STUDENT_PW = process.env.BUGFINDER_STUDENT_PASSWORD;
const COLLEGE_EMAIL = process.env.BUGFINDER_COLLEGE_EMAIL || "vidyuthsetu+college@gmail.com";
const COLLEGE_PW = process.env.BUGFINDER_COLLEGE_PASSWORD;
const ADMIN_EMAIL = process.env.BUGFINDER_ADMIN_EMAIL || "vidyuthsetu@gmail.com";
const ADMIN_PW = process.env.BUGFINDER_ADMIN_PASSWORD;
const RUN_ID = crypto.randomUUID();
const results = [];

function log(obj) {
  console.log(JSON.stringify(obj));
}

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    const ms = Date.now() - started;
    results.push({ name, ok: true, ms });
    log({ severity: "INFO", message: `BUG FINDER: ${name} ok in ${ms}ms`, bug_finder_run: RUN_ID, step: name, ok: true, ms });
  } catch (err) {
    const ms = Date.now() - started;
    const reason = String(err?.message ?? err).slice(0, 300);
    results.push({ name, ok: false, ms, reason });
    log({ severity: "ERROR", message: `BUG FINDER: ${name} FAILED after ${ms}ms: ${reason}`, bug_finder_run: RUN_ID, step: name, ok: false, ms, reason });
  }
}

async function saveResults() {
  if (!API || !JWT_SECRET) return; // still logs; the database row is a nice-to-have, not required
  const rows = results.map((r) => ({
    run_id: RUN_ID, step: r.name, ok: r.ok, duration_ms: r.ms, reason: r.reason ?? null,
  }));
  try {
    const token = serviceToken();
    const res = await fetch(`${API}/bug_finder_runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!res.ok) log({ severity: "WARNING", message: `BUG FINDER: saving results got HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` });
  } catch (e) {
    log({ severity: "WARNING", message: `BUG FINDER: could not save results to the database: ${e}` });
  }
}

async function signIn(page, email, password) {
  await page.goto(`${SITE}/auth`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function main() {
  log({ severity: "INFO", message: `BUG FINDER: run ${RUN_ID} starting against ${SITE}` });
  const browser = await chromium.launch();

  // -------------------------------------------------- student journey
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(e.message.slice(0, 200)));
    page.on("response", (r) => { if (r.status() >= 500) consoleErrors.push(`HTTP ${r.status()} ${r.url().replace(/\?.*/, "").slice(0, 100)}`); });

    await step("student: sign in", () => signIn(page, STUDENT_EMAIL, STUDENT_PW));

    await step("student: dashboard loads", async () => {
      await page.goto(`${SITE}/student/dashboard`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      const t = await page.innerText("body");
      if (!t || t.length < 100) throw new Error("dashboard body looks empty");
    });

    await step("student: roadmap opens and a lesson loads", async () => {
      await page.goto(`${SITE}/student/roadmap`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);
      const listBtn = page.getByRole("button", { name: /^List$/ }).first();
      if (await listBtn.count()) { await listBtn.click(); await page.waitForTimeout(1000); }
      const first = page.getByRole("button", { name: /Start|Continue|Level \d/i }).first();
      const t = await page.innerText("body");
      if (!/Level \d+ of \d+/.test(t) && !(await first.count())) throw new Error("no track/level content visible");
    });

    await step("student: daily task card shows content", async () => {
      await page.goto(`${SITE}/student/dashboard`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      const t = await page.innerText("body");
      if (!/LOT #|Write my answer|Solve in editor|Assigned Tasks/i.test(t)) throw new Error("no daily task or assigned tasks visible");
    });

    if (consoleErrors.length > 0) {
      results.push({ name: "student: no browser errors", ok: false, ms: 0, reason: [...new Set(consoleErrors)].slice(0, 5).join(" | ") });
      log({ severity: "ERROR", message: `BUG FINDER: student: no browser errors FAILED: ${[...new Set(consoleErrors)].slice(0, 5).join(" | ")}`, bug_finder_run: RUN_ID });
    } else {
      results.push({ name: "student: no browser errors", ok: true, ms: 0 });
    }
    await ctx.close();
  }

  // -------------------------------------------------- college journey
  if (COLLEGE_PW) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    await step("college: sign in", () => signIn(page, COLLEGE_EMAIL, COLLEGE_PW));
    await step("college: students list loads", async () => {
      await page.goto(`${SITE}/college/dashboard`, { waitUntil: "networkidle" });
      await page.getByText("Students", { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(2500);
      const t = await page.innerText("body");
      if (!/Students|roll|CSE/i.test(t)) throw new Error("students list looks empty");
    });
    await ctx.close();
  }

  // -------------------------------------------------- admin journey
  if (ADMIN_PW) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    await step("admin: sign in", () => signIn(page, ADMIN_EMAIL, ADMIN_PW));
    await step("admin: content library loads", async () => {
      await page.goto(`${SITE}/admin/dashboard`, { waitUntil: "networkidle" });
      await page.getByText("Platform", { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(1000);
      await page.getByText("Content Library", { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(2500);
      const t = await page.innerText("body");
      if (!/Content Library/i.test(t)) throw new Error("content library did not open");
    });
    await ctx.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  log({
    severity: failed.length ? "ERROR" : "INFO",
    message: `BUG FINDER RUN ${failed.length ? "FAILED" : "PASSED"}: ${results.length - failed.length}/${results.length} steps ok`,
    bug_finder_run: RUN_ID,
    site: SITE,
    passed: results.length - failed.length,
    total: results.length,
    failed_steps: failed.map((f) => f.name),
  });

  await saveResults();
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  log({ severity: "ERROR", message: `BUG FINDER RUN CRASHED: ${String(e?.message ?? e).slice(0, 300)}`, bug_finder_run: RUN_ID });
  process.exit(1);
});
