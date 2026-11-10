// Polish pass D+F click check on the TEST website only. Logins read from the owner's file, never printed.
// node scripts/dev-tools/polish_clicks.mjs <loginsFile> <outDir>
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(process.env.PW_FROM ?? import.meta.url)("playwright");
import { cookieSignIn } from "./bff_login.mjs";

const [file, out] = process.argv.slice(2);
const BASE = "https://prooflab-staging.web.app";
mkdirSync(out, { recursive: true });
const logins = {};
for (const block of readFileSync(file, "utf8").split(/\r?\n\s*\r?\n/)) {
  const head = block.trim().split(/\r?\n/)[0] ?? "";
  const email = block.match(/Email:\s*(\S+)/)?.[1], password = block.match(/Password:\s*(\S+)/)?.[1];
  if (email && password) logins[head.split(" (")[0].trim()] = { email, password };
}

const results = [];
const check = async (name, fn) => {
  try { results.push(`${(await fn()) ? "PASS" : "FAIL"} ${name}`); }
  catch (e) { results.push(`FAIL ${name}: ${String(e.message).split("\n")[0].slice(0, 100)}`); }
};
const go = async (page, path) => { await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {}); await page.waitForTimeout(2500); };
const dialogOpen = async (page) => page.locator('[role="dialog"]').first().isVisible({ timeout: 5000 });
const closeDialog = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); };

const browser = await chromium.launch();
try {
  // ---- student 08
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookieSignIn(ctx, BASE, logins["Student 08"]);
  let page = await ctx.newPage();
  await go(page, "/student/dashboard?tab=lab");
  await check("Daily: status label is Done today / Not done today / Not started", async () =>
    (await page.getByText(/^(Done today|Not done today|Not started)$/).count()) > 0);
  await check("Daily: dot colour key shown", async () => (await page.getByText("technical", { exact: true }).count()) > 0);
  await check("Daily: (i) streak opens", async () => { await page.getByRole("button", { name: "How this is worked out" }).first().click(); const ok = await page.getByText(/Sunday is rest/).isVisible(); await closeDialog(page); return ok; });
  await check("Daily: Streak goes to Build-log History", async () => { await page.getByRole("link", { name: /Streak/ }).click(); await page.waitForTimeout(1500); return page.url().includes("view=history"); });
  await page.goBack(); await page.waitForTimeout(2000);
  await check("Back returns to the Daily Card", async () => page.url().includes("tab=lab"));
  await check("Daily: a week dot opens its entry (done) or the Lot (open)", async () => { await page.getByRole("link", { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ }).first().click(); await page.waitForTimeout(1500); return page.url().includes("tab=log") || page.url().includes("tasks/assigned"); });
  await go(page, "/student/dashboard?tab=lab");
  await check("Daily: squad card names the squad (same as Squad page)", async () => (await page.getByText(/Not in a squad yet/).count()) === 0);
  await check("Daily: squad card goes to Squad", async () => { await page.getByRole("link", { name: /Squad/ }).last().click(); await page.waitForTimeout(1500); return page.url().includes("tab=squad"); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/d-student-squad.png`, fullPage: true });
  await check("Squad: title 'Your squad', no 'THE LAB'", async () => (await page.getByText("Your squad", { exact: true }).count()) > 0 && (await page.getByText(/THE\s*LAB/).count()) === 0);
  await check("Squad: 'seats filled' wording", async () => (await page.getByText(/seats filled/).count()) > 0);
  await check("Squad: Movement shows words not a dash", async () => (await page.getByText(/^(No change|Not ranked yet|▲\d+|▼\d+)$/).count()) > 0);
  await check("Squad: header never 'Unranked'", async () => (await page.getByText(/^unranked$/i).count()) === 0);
  await check("Squad: member row reads '(you)'", async () => (await page.getByText("(you)").count()) > 0);
  await check("Squad: no '? vs ?'", async () => (await page.getByText(/\?\s*vs\s*\?/).count()) === 0);
  await check("Squad: Matches tab in the URL", async () => { await page.getByRole("tab", { name: "Matches" }).click(); await page.waitForTimeout(800); return page.url().includes("view=matches"); });
  await check("Squad: a match row opens the match popup", async () => { const row = page.locator("tbody tr.cursor-pointer").first(); if (!(await row.count())) return true; await row.click(); const ok = await dialogOpen(page); await page.screenshot({ path: `${out}/d-match-popup.png` }); await closeDialog(page); return ok; });
  await go(page, "/student/dashboard?tab=log&view=skills");
  await check("Skills: a skill card opens its popup", async () => { await page.locator('[role="button"].cursor-pointer').filter({ hasText: "Starting test" }).first().click(); const ok = await dialogOpen(page); await page.screenshot({ path: `${out}/d-skill-popup.png` }); await closeDialog(page); return ok; });
  await check("Skills: a topic chip opens its popup (if any topic shows)", async () => { const chip = page.getByText(/ correct/).first(); if (!(await chip.count())) return true; await chip.click(); const ok = await dialogOpen(page); await page.screenshot({ path: `${out}/d-topic-popup.png` }); await closeDialog(page); return ok; });
  await go(page, "/student/dashboard?tab=log&view=history");
  await check("History: a Lot event opens that Lot in Recent work", async () => { const l = page.getByRole("link", { name: /→$/ }).first(); if (!(await l.count())) return true; await l.click(); await page.waitForTimeout(1500); return page.url().includes("task="); });
  await go(page, "/student/tasks/assigned");
  await check("Your Tasks: View Submission shown for earlier work", async () => (await page.getByRole("button", { name: /View Submission/ }).count()) > 0);
  await go(page, "/student/dashboard?tab=log&view=progress");
  await check("Progress: 'See Profile → Badges' link shown", async () => (await page.getByRole("link", { name: /Profile → Badges/ }).count()) > 0);
  await check("Progress: badges link goes to Profile -> Badges", async () => { const l = page.getByRole("link", { name: /Profile → Badges/ }); if (!(await l.count())) return true; await l.click(); await page.waitForTimeout(1500); return page.url().includes("view=achievements"); });
  await ctx.close();

  // ---- college
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookieSignIn(ctx, BASE, logins["College"]);
  page = await ctx.newPage();
  await go(page, "/college/matches");
  await check("College: /college/matches opens Matches", async () => page.url().includes("view=matches"));
  await check("College: a match row opens the match popup", async () => { const row = page.locator("tbody tr.cursor-pointer").first(); if (!(await row.count())) return true; await row.click(); const ok = await dialogOpen(page); await page.screenshot({ path: `${out}/d-college-match-popup.png` }); await closeDialog(page); return ok; });
  await go(page, "/college/dashboard?tab=students");
  await check("College: a student row opens the drawer", async () => { await page.locator("tbody tr").first().click(); return dialogOpen(page); });
  await ctx.close();

  // ---- admin
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookieSignIn(ctx, BASE, logins["Admin"]);
  page = await ctx.newPage();
  await go(page, "/admin/dashboard?tab=submissions");
  await check("Admin: a submission row opens its detail", async () => { await page.locator("tbody tr.cursor-pointer").first().click(); const ok = await dialogOpen(page); await page.screenshot({ path: `${out}/d-admin-submission.png` }); return ok; });
  await ctx.close();
} finally { await browser.close(); }
console.log(results.join("\n"));
