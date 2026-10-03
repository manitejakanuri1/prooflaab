// Browser E2E against STAGING through a local staging build. Never production.
//
//   npx vite --mode staging --port 5173            (separate terminal)
//   node scripts/dev-tools/staging_browser_e2e.mjs [student|established|tpo|company|admin ...]
//
// Signs in as the protected staging fixtures (docs/STAGING-TEST-FIXTURES.md) by
// placing a staging ticket in the browser session, minted from Secret Manager at
// run time - shaped exactly like the staging auth-bridge's. Real Google sign-in is
// not exercised here (staging shares production's Identity pool; see fixtures doc).
//
// Every step records: what was checked, console errors, failed requests (>=400),
// and a screenshot under E2E_OUT (default ./e2e-out). Exit code = number of failures.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://localhost:5173";
const OUT = process.env.E2E_OUT ?? "e2e-out";
mkdirSync(OUT, { recursive: true });

const FIX = {
  admin: { id: "ffed80fc-08ee-4cce-ac54-9432ef2d81f9", email: "e2e.admin@staging.prooflab.invalid" },
  tpo: { id: "99999999-0000-0000-0000-000000000001", email: "college@staging.prooflab.invalid" },
  company: { id: "b19ab84b-2ebe-4dc8-8a51-470b2193168e", email: "probe.company@test.invalid" },
  student: { id: "b3786001-a791-449a-bcd3-115f222a8bf1", email: "e2e.student@staging.prooflab.invalid" },
  established: { id: "99999999-0001-0000-0000-000000000001", email: "student1@staging.prooflab.invalid" },
};

const secret = execSync("gcloud secrets versions access latest --secret=prooflab-staging-jwt-secret", { encoding: "utf8" }).trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function ticket(sub, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, role: "authenticated", email, email_confirmed: true, exp });
  return { token: `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`, exp };
}
function session(who) {
  const { id, email } = FIX[who];
  const { token, exp } = ticket(id, email);
  const now = new Date().toISOString();
  return {
    access_token: token, refresh_token: "staging-e2e-no-refresh", expires_in: 3600, expires_at: exp,
    token_type: "bearer", provider_token: "",
    user: { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: now, phone: "",
            created_at: now, updated_at: now, last_sign_in_at: now, app_metadata: {}, user_metadata: {}, identities: [] },
  };
}

const results = [];
async function journey(who, steps) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value),
    ["prooflab.auth.google", JSON.stringify(session(who))]);
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`); });
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes("/ready") && !u.includes("favicon")) problems.push(`HTTP ${r.status()} ${u.replace(/\?.*/, "").slice(0, 140)}`);
  });
  let n = 0;
  for (const [name, fn] of steps) {
    n++;
    problems.length = 0;
    let ok = true; let detail = "";
    try { detail = (await fn(page)) ?? ""; } catch (e) { ok = false; detail = String(e.message ?? e).slice(0, 300); }
    await page.waitForTimeout(800);
    const shot = `${OUT}/${who}-${String(n).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    const serverErrors = problems.filter((p) => /HTTP 5\d\d/.test(p));
    if (serverErrors.length) ok = false;
    results.push({ who, step: name, ok, detail, problems: [...new Set(problems)].slice(0, 8), shot });
    console.log(`${ok ? "PASS" : "FAIL"} ${who}: ${name}${detail ? ` - ${detail}` : ""}${problems.length ? `\n      ${[...new Set(problems)].slice(0, 5).join("\n      ")}` : ""}`);
  }
  await browser.close();
}

const go = (path) => async (page) => { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 }); };
const see = (text, timeout = 20000) => async (page) => { await page.getByText(text.includes("|") ? new RegExp(text) : text, { exact: false }).first().waitFor({ timeout }); return `saw "${text}"`; };
const click = (text) => async (page) => { await page.getByText(text, { exact: true }).first().click({ timeout: 15000 }); await page.waitForLoadState("networkidle"); };
const seq = (...fns) => async (page) => { let last; for (const f of fns) last = await f(page); return last; };
const noText = (text) => async (page) => {
  const n = await page.getByText(text, { exact: false }).count();
  if (n) throw new Error(`legacy text still visible: "${text}" (${n})`);
  return `no "${text}"`;
};

const JOURNEYS = {
  established: [
    ["dashboard loads", seq(go("/student/dashboard"), see("Daily Card"))],
    ["Build-Log shows real work, no Cosigns", seq(click("Build-Log"), see("Entries"), see("Tests passed|Being checked|Nothing here yet"), noText("Cosigns"))],
    ["Squad shows teammate names", seq(click("Squad"), see("Squad"), click("Members"), see("Fake Student 2"), see("Fake Student 3"))],
    ["Profile", seq(click("Profile"), see("Resume"))],
  ],
  student: [
    ["fresh student lands on intake", seq(go("/student/dashboard"), async (p) => { await p.waitForURL(/student\/(start|resume-onboarding|interest-onboarding|dashboard)/, { timeout: 20000 }); return p.url(); })],
  ],
  tpo: [
    ["college home", seq(go("/college/dashboard"), see("Students"))],
    ["Students: real Lots done, no Trust", seq(click("Students"), see("Fake Student 1"), noText("Trust"))],
    ["Student profile: recent work, no Trust", seq(click("Fake Student 1"), see("Count failed logins per user"), see("Lots done"), noText("Trust score"), async (p) => { await p.keyboard.press("Escape"); return "no Trust score; real recent work"; })],
    ["Squads", seq(click("Squads"), see("Squad"))],
    ["Insights", seq(click("Insights"), see("Insights"))],
  ],
  company: [
    ["company home", seq(go("/company/dashboard"), see("Talent"))],
    ["Talent", click("Talent")],
    ["Shortlist", click("Shortlist")],
    ["Lots", seq(click("Lots"), see("Sponsored Lots"))],
    ["Submissions shows real work", seq(click("Submissions"), see("PROBE sponsored lot"), see("Tests passed|Spoken explanation|No spoken explanation"))],
    ["Review", seq(click("Review"), see("Work to review"))],
  ],
  admin: [
    ["admin dashboard", seq(go("/admin/dashboard"), see("Overview"))],
    ["no Proof Review / Trust & XP in the menu", seq(click("Work Queue"), noText("Proof Review"), noText("Trust & XP"))],
    ["Submissions (current work)", seq(click("Submissions"), see("Submissions"), see("Count failed logins per user"))],
    ["Flagged submissions", seq(click("Flagged submissions"), see("Flag|flag|No submissions|review"))],
    ["Task Oversight", seq(click("Task Oversight"), see("Task"))],
    ["Token Usage (AI spend)", seq(click("Platform"), click("Token Usage"), see("Token|Usage|usage"))],
    ["Security Events", seq(click("Security Events"), see("Security|Event|event"))],
  ],
};

const who = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(JOURNEYS);
for (const w of who) await journey(w, JOURNEYS[w]);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} steps passed; screenshots in ${OUT}/`);
process.exit(failed);
