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
import { stagingSession } from "./staging_token.mjs";
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

function session(who) {
  const { id, email } = FIX[who];
  return stagingSession(id, email);
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

// The sidebar of a role must show exactly these four destinations, and none of the retired ones.
const menuIs = (labels, gone = []) => async (page) => {
  for (const l of labels) await page.locator('[data-sidebar="menu-button"], aside button, nav button').filter({ hasText: new RegExp(`^\s*${l}`) }).first().waitFor({ timeout: 15000 });
  for (const g of gone) {
    const n = await page.locator('[data-sidebar="menu-button"]').filter({ hasText: new RegExp(`^\s*${g}\s*$`) }).count();
    if (n) throw new Error(`retired menu item still shown: "${g}"`);
  }
  return `menu = ${labels.join(" / ")}`;
};
const urlHas = (part) => async (page) => {
  try { await page.waitForURL((u) => u.toString().includes(part), { timeout: 15000 }); }
  catch { throw new Error(`expected the address to contain "${part}", it is ${page.url().replace(BASE, "")}`); }
  return page.url().replace(BASE, "");
};
const reload = async (page) => { await page.reload({ waitUntil: "networkidle" }); };
const back = async (page) => { await page.goBack({ waitUntil: "networkidle" }); };

const JOURNEYS = {
  established: [
    ["Floor is the landing screen; menu has 4 items", seq(go("/student/dashboard"), see("Daily Card|Today"), menuIs(["Floor", "Build-log", "Squad", "Profile"], ["Daily Card", "Voice", "Progress", "Portfolio", "Resume"]))],
    ["Build-log: recent work with marks, no Cosigns", seq(click("Build-log"), urlHas("tab=log"), see("Recent work"), see("Task result"), see("Voice explanation"), see("Tests passed 6 of 6"), see("View detailed feedback"), noText("Cosigns"), noText("Trust"))],
    ["Build-log inner view survives refresh and Back", seq(click("Skills evidence"), urlHas("view=skills"), reload, urlHas("view=skills"), click("History"), urlHas("view=history"), back, urlHas("view=skills"))],
    ["Squad shows teammate names", seq(click("Squad"), see("Squad"), click("Members"), see("Fake Student 2"), see("Fake Student 3"))],
    ["Profile groups resume, portfolio, privacy", seq(click("Profile"), see("Resume"), see("Portfolio"), see("Privacy"))],
    ["Deep link opens Profile > Portfolio", seq(go("/student/dashboard?tab=profile&view=portfolio"), see("Proven work"))],
    ["Old student links land on a real page", seq(go("/student/dashboard?tab=uploads"), see("Recent work"), go("/student/roadmap"), see("Roadmap"))],
    ["Public portfolio shows passed Lots, no Trust, no proof files", seq(go("/portfolio/fake-student-1"), see("Proven work"), see("Count failed logins per user"), see("Explained"), noText("Trust"), noText("Projects & Achievements"))],
  ],
  student: [
    ["fresh student lands on intake", seq(go("/student/dashboard"), async (p) => { await p.waitForURL(/student\/(start|resume-onboarding|interest-onboarding|dashboard)/, { timeout: 20000 }); return p.url(); })],
  ],
  tpo: [
    ["college home; menu has 4 items", seq(go("/college/dashboard"), see("Students"), menuIs(["Home", "Students", "Squads", "Insights"]))],
    ["Students: real Lots done, no Trust", seq(click("Students"), urlHas("tab=students"), see("Fake Student 1"), noText("Trust"))],
    ["Student profile: recent work, no Trust", seq(click("Fake Student 1"), see("Count failed logins per user"), see("Lots done"), noText("Trust score"), async (p) => { await p.keyboard.press("Escape"); return "no Trust score; real recent work"; })],
    ["Squads", seq(click("Squads"), urlHas("tab=squads"), see("Squad"))],
    ["Insights survives refresh", seq(click("Insights"), urlHas("tab=insights"), reload, urlHas("tab=insights"), see("Insights"))],
    ["Back returns to Squads", seq(back, urlHas("tab=squads"))],
  ],
  company: [
    ["company home; menu is Home / Talent / Lots / Hiring only", seq(go("/company/dashboard"), see("Talent"), menuIs(["Home", "Talent", "Lots", "Hiring"], ["Shortlist", "Submissions", "Review", "Jobs"]))],
    ["Talent", seq(click("Talent"), urlHas("tab=talent"))],
    ["Lots > My Lots shows submission and explanation state", seq(click("Lots"), urlHas("tab=lots"), see("My Lots"), see("Count failed logins per user"), see("Passed"))],
    ["Lots > Submissions shows real work", seq(click("Submissions"), urlHas("view=submissions"), see("PROBE sponsored lot"), see("Tests passed|Spoken explanation|No spoken explanation"))],
    ["Lots > Reviews survives refresh", seq(click("Reviews"), urlHas("view=reviews"), reload, urlHas("view=reviews"), see("Spoken explanation|Accept|Nothing"))],
    ["Lots > Create a Lot", seq(click("Create a Lot"), urlHas("view=create"), see("Set a task|shortlisted"))],
    ["Hiring holds the shortlist and job posts", seq(click("Hiring"), urlHas("tab=hiring"), see("Shortlist"), see("Job posts"))],
    ["Old company links redirect", seq(go("/company/dashboard?tab=submissions"), urlHas("tab=lots"), see("My Lots"), go("/company/dashboard?tab=shortlist"), urlHas("tab=hiring"), go("/company/dashboard?tab=review"), urlHas("view=reviews"))],
  ],
  admin: [
    ["admin home; menu is Home / People / Work / Operations", seq(go("/admin/dashboard"), see("Overview"), menuIs(["Home", "People", "Work", "Operations"], ["Work Queue", "Platform", "Proof Review", "Trust & XP"]))],
    ["People", seq(click("People"), see("Students"), see("Companies"), see("Colleges"))],
    ["Work > Submissions (current work)", seq(click("Work"), noText("Proof Review"), click("Submissions"), urlHas("tab=submissions"), see("passed ·|failed ·|needs_review"))],   // newest 200 rows; any real graded row proves current work (a fixed title falls off the page once load tests add work)
    ["Work > Flags & reviews", seq(click("Flags & reviews"), see("Flag|flag|No submissions|review"))],
    ["Operations > AI usage", seq(click("Operations"), click("AI usage"), see("Token|Usage|usage"))],
    ["Operations > Jobs & health survives refresh", seq(click("Jobs & health"), urlHas("tab=ops-jobs"), see("Lots dated today"), reload, see("Voice queue"))],
    ["Operations > Security & audit; Back works", seq(click("Security & audit"), see("Security|Event|event"), back, urlHas("tab=ops-jobs"))],
    ["Old admin people link still opens", seq(go("/admin/dashboard/user-management/students"), see("Students"))],
  ],
};

const who = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(JOURNEYS);
for (const w of who) await journey(w, JOURNEYS[w]);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} steps passed; screenshots in ${OUT}/`);
process.exit(failed);
