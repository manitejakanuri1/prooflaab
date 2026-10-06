// STAGING ONLY. Opens EVERY screen of every role (read-only: navigation only, no clicks, dialogs dismissed)
// and records per screen: crash (page error / error boundary), console errors, failed requests (>= 400),
// and whether the screen rendered real content. Complements staging_browser_e2e.mjs, which checks content.
//   E2E_BASE=https://prooflab-staging.web.app node scripts/dev-tools/staging_screen_walk.mjs
// Exit code = number of screens with a problem. Results: e2e-out/final/screen-walk.json
import { chromium } from "playwright";
import { createHash, createPublicKey, createSign } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_BASE;
if (!BASE || !BASE.includes("staging")) throw new Error("E2E_BASE must be the staging site");
const FIX = {
  admin: { id: "ffed80fc-08ee-4cce-ac54-9432ef2d81f9", email: "e2e.admin@staging.prooflab.invalid" },
  tpo: { id: "99999999-0000-0000-0000-000000000001", email: "college@staging.prooflab.invalid" },
  company: { id: "b19ab84b-2ebe-4dc8-8a51-470b2193168e", email: "probe.company@test.invalid" },
  student: { id: "99999999-0001-0000-0000-000000000001", email: "student1@staging.prooflab.invalid" },
};
const S = "/student/dashboard", C = "/college/dashboard", K = "/company/dashboard", A = "/admin/dashboard";
const SCREENS = {
  student: [`${S}?tab=lab`, ...["entries", "progress", "skills", "history"].map((v) => `${S}?tab=log&view=${v}`), `${S}?tab=squad`,
    ...["proof", "roadmap", "resume", "interview", "certifications", "achievements", "role", "portfolio", "privacy", "settings"].map((v) => `${S}?tab=profile&view=${v}`),
    "/student/roadmap", "/student/tasks/assigned", "/portfolio/fake-student-1"],
  tpo: ["home", "students", "squads", "insights", "notifications", "profile", "settings"].map((t) => `${C}?tab=${t}`),
  company: [`${K}?tab=home`, `${K}?tab=talent`, ...["active", "submissions", "reviews", "create"].map((v) => `${K}?tab=lots&view=${v}`),
    ...["shortlist", "jobs"].map((v) => `${K}?tab=hiring&view=${v}`), `${K}?tab=settings`],
  admin: [...["dashboard", "analytics", "announcements", "students", "colleges", "startups", "college-oversight", "student-oversight", "settings",
    "task-oversight", "daily-lots", "submissions", "reviewed-submissions", "assign-tasks", "content-library", "jobs", "resources",
    "token-usage", "ops-jobs", "security-events", "student-trace", "bug-finder"].map((t) => `${A}?tab=${t}`),
    ...["timeline", "funnels", "problems"].map((v) => `${A}?tab=student-trace&view=${v}`), "/admin/notifications"],
};

const pem = execSync("gcloud secrets versions access latest --secret=prooflab-staging-app-signing-key", { encoding: "utf8" });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const kid = createHash("sha256").update(createPublicKey(pem).export({ format: "jwk" }).n).digest("hex").slice(0, 16);
function session({ id, email }) {
  const exp = Math.floor(Date.now() / 1000) + 3600, now = new Date().toISOString();
  const h = b64({ alg: "RS256", typ: "JWT", kid }), p = b64({ sub: id, role: "authenticated", email, email_confirmed: true, exp });
  return { access_token: `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(pem).toString("base64url")}`,
    refresh_token: "staging-e2e-no-refresh", expires_in: 3600, expires_at: exp, token_type: "bearer", provider_token: "",
    user: { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: now, phone: "", created_at: now, updated_at: now,
            last_sign_in_at: now, app_metadata: {}, user_metadata: {}, identities: [] } };
}

const rows = [];
const browser = await chromium.launch();
for (const [role, screens] of Object.entries(SCREENS)) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ["prooflab.auth.google", JSON.stringify(session(FIX[role]))]);
  const page = await context.newPage();
  let problems = [];
  page.on("dialog", (d) => { problems.push(`dialog: ${d.message().slice(0, 80)}`); void d.dismiss(); });
  page.on("pageerror", (e) => problems.push(`CRASH: ${e.message.slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 160)}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("google")) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, "").slice(-70)}`); });
  for (const path of screens) {
    problems = [];
    const t0 = Date.now();
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => problems.push(`load: ${e.message.slice(0, 80)}`));
    await page.waitForTimeout(1500);
    const text = (await page.locator("main, body").first().innerText().catch(() => "")).replace(/\s+/g, " ");
    if (/Something went wrong|Unexpected Application Error|Page not found|404/i.test(text.slice(0, 2000))) problems.push(`error text on page: ${text.match(/Something went wrong|Unexpected Application Error|Page not found|404/i)[0]}`);
    const landed = page.url().replace(BASE, "");
    const row = { role, path, landed, ms: Date.now() - t0, chars: text.length, problems: [...new Set(problems)] };
    row.ok = row.problems.filter((p) => !p.startsWith("dialog")).length === 0 && text.length > 150;   // an empty state (e.g. "No notifications found", 182 chars) still counts as rendered
    rows.push(row);
    console.log(`${row.ok ? "OK  " : "BAD "} ${role.padEnd(7)} ${path.padEnd(48)} -> ${landed.slice(0, 50).padEnd(50)} ${String(row.ms).padStart(5)}ms ${row.chars}ch ${row.problems.join(" | ").slice(0, 300)}`);
  }
  await context.close();
}
await browser.close();
mkdirSync("e2e-out/final", { recursive: true });
writeFileSync("e2e-out/final/screen-walk.json", JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - bad}/${rows.length} screens clean`);
process.exit(bad);
