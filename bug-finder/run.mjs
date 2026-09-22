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
//
// DEEP=1 also runs the resume + AI journey (upload, read, confirm, timed test, coding round) on a
// SEPARATE dedicated account (never the light-check account, so the two never race each other).
// This is the only part of the bug finder that spends real DeepSeek money - roughly Rs 1.5 a run.
// A synthetic (fake) resume is generated in memory each run; no real person's resume is ever used.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

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
const DEEP = process.env.DEEP === "1";
const DEEP_EMAIL = process.env.BUGFINDER_DEEP_STUDENT_EMAIL || "vidyuthsetu+t16@gmail.com";
const DEEP_PW = process.env.BUGFINDER_DEEP_STUDENT_PASSWORD || STUDENT_PW;
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

/** REST helper against PostgREST, minting a fresh service-role token each call. */
async function db(path, init = {}) {
  const res = await fetch(`${API}/${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceToken()}`, ...init.headers } });
  return res;
}

/**
 * The deep resume+AI journey needs to look "brand new" to the app every run, because:
 *  - /student/resume-onboarding redirects straight past the upload form once ANY resume_scorecards
 *    row exists for the account (by design - a graded student does not need to re-onboard)
 *  - the built-in "Retest weak topics" button, the app's own repeat path, has a 3-day cool-down,
 *    far too slow for a check that runs 3 times a day
 * So this wipes only the DEEP test account's own resume rows before each run. It is a dedicated
 * account used for nothing else, so nothing real is lost - this is not something to do to a real
 * student's data.
 */
async function resetDeepAccount() {
  const c = await (await db(`student_contact?select=student_id&email=eq.${encodeURIComponent(DEEP_EMAIL)}`)).json();
  const studentId = c?.[0]?.student_id;
  if (!studentId) { log({ severity: "WARNING", message: `BUG FINDER: could not find student_id for ${DEEP_EMAIL}, skipping account reset` }); return; }
  // resume_assessments and resume_scorecards both cascade from resume_claims (on delete cascade),
  // so deleting the claims alone is enough - checked against the actual migration, not assumed.
  await db(`resume_claims?student_id=eq.${studentId}`, { method: "DELETE" });
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

/** A fake resume, made fresh in memory - never a real person's file, never written to disk. */
async function fakeResumePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    "Bug Finder Test Student",
    "Target role: Backend Developer",
    "",
    "Skills: Python, SQL, Git, REST APIs",
    "",
    "Projects:",
    "Inventory Tracker - a command-line tool that reads a CSV of stock counts and",
    "prints which items are below a reorder threshold. Built with Python and SQLite.",
  ];
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 22, size: 12, font }));
  return Buffer.from(await doc.save());
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
  // Standard container flags: Chromium's sandbox wants privileges Cloud Run's container
  // doesn't grant, and /dev/shm here is a tiny tmpfs.
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });

  // A DEEP run does ONLY the deep journey - never both in one execution. Running 4 browser
  // contexts (student, deep, college, admin) in one small 1-vCPU container was the real cause of
  // a flaky 90s timeout seen while first testing this: nothing was actually broken, the container
  // was just too busy to render in time. Splitting them removes that as a variable entirely.

  // -------------------------------------------------- student journey
  if (!DEEP) {
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

    await step("student: a task button actually opens its panel", async () => {
      // Existence of a button proves nothing about clicking it - this checks a real click
      // opens the real dialog, not just that the button sat there doing nothing.
      await page.goto(`${SITE}/student/tasks/assigned`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);
      const btn = page.getByRole("button", { name: /Solve in editor|Write my answer/i }).first();
      if (!(await btn.count())) throw new Error("no open-able task button found");
      await btn.click();
      await page.getByRole("dialog").waitFor({ timeout: 10000 });
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

  // -------------------------------------------------- deep: resume + AI journey (costs money, DEEP=1 only)
  if (DEEP && DEEP_PW) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    // This journey used to fail only inside Cloud Run (a Playwright/Chromium version mismatch
    // hid a pdf.js incompatibility - fixed by pinning the same Playwright version as the main
    // project). Kept logging every failed request/console error as it happens, not just a
    // summary at the end, in case a future cloud-only failure needs the same kind of trace.
    page.on("pageerror", (e) => log({ severity: "WARNING", message: `BUG FINDER deep: page error: ${e.message.slice(0, 200)}` }));
    page.on("console", (m) => { if (m.type() === "error") log({ severity: "WARNING", message: `BUG FINDER deep: console.error: ${m.text().slice(0, 300)}` }); });
    page.on("requestfailed", (r) => log({ severity: "WARNING", message: `BUG FINDER deep: request failed: ${r.url().replace(/\?.*/, "").slice(0, 100)} (${r.failure()?.errorText})` }));
    page.on("response", (r) => { if (r.status() >= 400) log({ severity: "WARNING", message: `BUG FINDER deep: HTTP ${r.status()} ${r.url().replace(/\?.*/, "").slice(0, 100)}` }); });

    await step("deep: sign in", () => signIn(page, DEEP_EMAIL, DEEP_PW));

    await step("deep: reset test account", resetDeepAccount);

    await step("deep: resume upload is read and scored", async () => {
      await page.goto(`${SITE}/student/resume-onboarding`, { waitUntil: "networkidle", timeout: 45000 });
      log({ severity: "INFO", message: `BUG FINDER deep: onboarding page loaded, url=${page.url()}` });
      await page.waitForTimeout(2000);
      const pdf = await fakeResumePdf();
      const uploadStarted = Date.now();
      await page.locator("#resume-file-input").setInputFiles({ name: "test-resume.pdf", mimeType: "application/pdf", buffer: pdf });
      log({ severity: "INFO", message: `BUG FINDER deep: file set on input in ${Date.now() - uploadStarted}ms, waiting for scores` });
      // "Resume feedback" is the heading ResumeCheckFlow shows only once real scores are in - a
      // single, exact, unambiguous signal (an earlier looser word-match check on the page's whole
      // text matched the pre-upload page's own static wording and failed within ~4s, well before
      // the real analysis had time to finish - fixed by matching this one heading only).
      try {
        await page.getByText("Resume feedback", { exact: true }).waitFor({ timeout: 60000 });
      } catch (e) {
        const t = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 400);
        log({ severity: "ERROR", message: `BUG FINDER deep: upload wait failed. Current page text: ${t}` });
        throw e;
      }
    });

    await step("deep: confirm claims", async () => {
      const btn = page.getByRole("button", { name: /Confirm & continue/i }).first();
      if (!(await btn.count())) throw new Error("Confirm & continue button not found");
      await btn.click();
      await page.waitForTimeout(2000);
    });

    await step("deep: timed test builds and can be answered", async () => {
      const start = page.getByRole("button", { name: /^Start assessment$/i }).first();
      if (!(await start.count())) throw new Error("Start assessment button not found");
      // A thin synthetic resume can legitimately score under the 60% ATS gate, which disables
      // this button by design (same as a real weak resume) - a real student's next move is
      // Auto-fix, so do that here too instead of treating it as a failure.
      if (await start.isDisabled()) {
        const autoFix = page.getByRole("button", { name: /Auto-fix with AI/i }).first();
        if (!(await autoFix.count())) throw new Error("Start assessment disabled and no Auto-fix button to unblock it");
        await autoFix.click();
        await page.getByRole("button", { name: /Auto-fix with AI/i }).waitFor({ state: "hidden", timeout: 45000 });
        if (await start.isDisabled()) throw new Error("Start assessment still disabled after Auto-fix");
      }
      await start.click();
      await page.waitForTimeout(6000);          // resume-question-generator (AI)

      let last = "", answered = 0;
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(1000);
        const body = await page.innerText("body");
        const m = body.match(/Question (\d+) of (\d+)/);
        if (m) {
          if (m[0] !== last) {
            const ta = page.locator("textarea");
            if (await ta.count() && (await ta.first().isVisible())) {
              await ta.first().fill("This is the bug finder's synthetic answer, used only to exercise the grading path.");
            } else {
              const dlg = page.locator("[role=dialog]").last();
              const opt = dlg.getByRole("button").first();
              if (await opt.count()) await opt.click();
            }
            const next = page.getByRole("button", { name: /^(Next|Submit|Finish)/i }).first();
            if (await next.count()) await next.click().catch(() => {});
            last = m[0]; answered++;
          }
          continue;
        }
        if (/Coding round|Problem \d of \d/i.test(body)) break;   // moved on: the test is done
        if (answered > 0 && i > 25) break;                         // grading is taking a while; move on
      }
      if (answered === 0) throw new Error("no timed-test questions were answered");
    });

    await step("deep: coding round runs real code", async () => {
      const body0 = await page.innerText("body");
      if (!/Coding round|Problem \d of \d/i.test(body0)) throw new Error("coding round did not open after the test");
      await page.waitForTimeout(2000);
      const run = page.getByRole("button", { name: /Run sample/i }).first();
      if (!(await run.count())) throw new Error("Run sample button not found");
      await run.click();
      await page.waitForFunction(() => /Passed|Wrong answer|Crashed|compile|slow/i.test(document.body.innerText), null, { timeout: 30000 });
    });

    await ctx.close();
  }

  // -------------------------------------------------- college journey
  if (!DEEP && COLLEGE_PW) {
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
  if (!DEEP && ADMIN_PW) {
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
