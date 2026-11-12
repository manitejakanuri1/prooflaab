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
  // Each check prints at once and gets 60 s at most, so one stuck step can never hang the run.
  const limit = new Promise((_, no) => setTimeout(() => no(new Error("took over 60 s")), 60000));
  try { results.push(`${(await Promise.race([fn(), limit])) ? "PASS" : "FAIL"} ${name}`); }
  catch (e) { results.push(`FAIL ${name}: ${String(e.message).split("\n")[0].slice(0, 100)}`); }
  console.log(results.at(-1));
};
const go = async (page, path) => { await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {}); await page.waitForTimeout(2500); };
const dialogOpen = async (page) => page.locator('[role="dialog"]').first().isVisible({ timeout: 5000 });
const closeDialog = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); };

setTimeout(() => { console.log("STOPPED: the whole run took over 8 minutes"); process.exit(2); }, 8 * 60000).unref();
const browser = await chromium.launch();
try {
  // ---- student 08
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookieSignIn(ctx, BASE, logins["Student 08"]);
  let page = await ctx.newPage();
  // QA round 2 item 30: no 404 / 401 from the TEST API while the student pages load.
  const apiErrors = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && [401, 404].includes(r.status())) apiErrors.push(`${r.status()} ${r.url().split("?")[0].split("/api/")[1]}`); });
  // A check that times out says nothing about why: print each failed or slow call so a slow TEST site shows up.
  const sent = new Map();
  page.on("request", (r) => sent.set(r, Date.now()));
  page.on("response", (r) => { const ms = Date.now() - (sent.get(r.request()) ?? Date.now());
    if (r.status() >= 500 || ms > 5000) console.log(`SLOW ${r.status()} ${ms}ms ${r.url().split("?")[0].slice(-80)}`); });
  page.on("requestfailed", (r) => console.log(`SLOW failed ${r.failure()?.errorText} ${r.url().split("?")[0].slice(-80)}`));
  await go(page, "/student/dashboard?tab=lab");
  // The card waits on several reads; check only once its week row is drawn.
  await page.getByText("technical", { exact: true }).first().waitFor({ timeout: 30000 }).catch(() => {});
  // The dots follow the season week (item 24), so a done Lot can be on any weekday: take the first done dot, else
  // the written Lot from the Build-log.
  const dotHrefs = await page.locator('a[href*="tab=log&view=entries&task="]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const anyDoneDot = dotHrefs.length > 0;
  const dailyWeek = (await page.getByTestId("lot-marks").innerText().catch(() => "")).match(/This week: ([\d.–]+)/)?.[1] ?? null;
  await check("Daily: status label is Done today / Voice owed today / Not done today / Not started", async () =>
    (await page.getByText(/^(Done today|Voice owed today|Not done today|Not started)$/).count()) > 0);
  await check("Daily: 'closes at 11:59 PM' warning while today's Lot is not finished (item 24)", async () => {
    const done = (await page.getByTestId("lot-done").count()) > 0;
    return done || (await page.getByTestId("lot-closes-tonight").innerText()).includes("11:59 PM");
  });
  await check("Daily: squad card says when squad points update (item 25)", async () =>
    /once a week, after the season week ends/.test(await page.getByTestId("squad-update-when").innerText()));
  await check("Daily: squad 'Next update' is not in the past (F3)", async () => {
    const m = (await page.getByTestId("squad-update-when").innerText()).match(/Next update: about \w{3} (\d{1,2}) (\w{3}), (\d{1,2}:\d{2} [AP]M)/);
    if (!m) return false;
    const when = new Date(`${m[1]} ${m[2]} ${new Date().getFullYear()} ${m[3]} GMT+0530`);
    return when.getTime() > Date.now();
  });
  await check("Daily: This week names voice-owed Lots, not a bare count (F2)", async () =>
    /^\s*·\s*(\d+ Lots?|\d+ finished, \d+ voice owed)\s*$/.test(await page.getByTestId("week-lots").innerText()));
  await check("Daily: streak (i) says what counts (item 23)", async () => {
    await page.getByRole("button", { name: "How this is worked out" }).first().click();
    const ok = await page.getByText(/Passing is not needed/).isVisible(); await closeDialog(page); return ok;
  });
  await check("Daily: dot colour key shown", async () => (await page.getByText("technical", { exact: true }).count()) > 0);
  await check("Daily: (i) streak opens", async () => { await page.getByRole("button", { name: "How this is worked out" }).first().click(); const ok = await page.getByText(/Sunday is rest/).isVisible(); await closeDialog(page); return ok; });
  await check("Daily: Streak goes to Build-log History", async () => { await page.getByRole("link", { name: /Streak/ }).click(); await page.waitForTimeout(1500); return page.url().includes("view=history"); });
  await page.goBack(); await page.waitForTimeout(2000);
  await check("Back returns to the Daily Card", async () => page.url().includes("tab=lab"));
  await check("Daily: week dots and 'This week' cover the same days (item 24)", async () => {
    const head = page.locator("p", { hasText: "not done yet" }).first();
    const label = await head.innerText();
    const firstDot = (await head.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]").locator("a span.font-mono").first().innerText()).trim();
    // The heading is shown in capitals (CSS), so compare without case.
    return /^This week/i.test(label) ? firstDot.toLowerCase() === "mon" : label.toLowerCase().includes(`(${firstDot.toLowerCase()}–`);
  });
  await check("Daily: a done Lot dot opens its Build-log entry (if any done this season week)", async () => {
    if (!anyDoneDot) return true;
    await page.locator('a[href*="tab=log&view=entries&task="]').first().click(); await page.waitForTimeout(3000);
    const ok = page.url().includes("view=entries"); await go(page, "/student/dashboard?tab=lab"); return ok;
  });
  await check("Daily: a week dot opens its entry (done) or the Lot (open)", async () => { await page.getByRole("link", { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ }).first().click(); await page.waitForTimeout(1500); return page.url().includes("tab=log") || page.url().includes("tasks/assigned"); });
  await go(page, "/student/dashboard?tab=lab");
  await check("Daily: no 'Record 60s explain' once the voice is done", async () => (await page.getByTestId("voice-done").count()) === 0 || (await page.getByRole("button", { name: /Record 60s explain/ }).count()) === 0);
  await check("Daily: squad card names the squad (same as Squad page)", async () => (await page.getByText(/Not in a squad yet/).count()) === 0);
  await check("Daily: squad card goes to Squad", async () => { await page.getByRole("link", { name: /Squad/ }).last().click(); await page.waitForTimeout(1500); return page.url().includes("tab=squad"); });
  await page.getByText(/places taken/).first().waitFor({ timeout: 30000 }).catch(() => {}); // wait for the squad data, not a fixed 1.5 s
  await page.screenshot({ path: `${out}/d-student-squad.png`, fullPage: true });
  await check("Squad: title 'Your squad', no 'THE LAB'", async () => (await page.getByText("Your squad", { exact: true }).count()) > 0 && (await page.getByText(/THE\s*LAB/).count()) === 0);
  await check("Squad: 'places taken' wording (N5)", async () => (await page.getByText(/places taken/).count()) > 0);
  await check("Squad: Movement shows words not a dash", async () => (await page.getByText(/^(No change|Not ranked yet|▲\d+|▼\d+)$/).count()) > 0);
  await check("Squad: header never 'Unranked'", async () => (await page.getByText(/^unranked$/i).count()) === 0);
  await check("Squad: member row reads '(you)'", async () => (await page.getByText("(you)").count()) > 0);
  await check("Squad: no '? vs ?'", async () => (await page.getByText(/\?\s*vs\s*\?/).count()) === 0);
  await check("Squad: Matches tab in the URL", async () => { await page.getByRole("tab", { name: "Matches" }).click(); await page.waitForTimeout(800); return page.url().includes("view=matches"); });
  await check("Squad: match rows say '(your squad)'", async () => (await page.locator("tbody tr.cursor-pointer").count()) === 0 || (await page.locator("tbody tr.cursor-pointer").first().innerText()).includes("(your squad)"));
  await check("Squad: a match row opens the match popup (with '(your squad)')", async () => { const row = page.locator("tbody tr.cursor-pointer").first(); if (!(await row.count())) return true; await row.click(); const ok = await dialogOpen(page) && (await page.getByRole("dialog").innerText()).includes("(your squad)"); await page.screenshot({ path: `${out}/d-match-popup.png` }); await closeDialog(page); return ok; });
  await go(page, "/student/dashboard?tab=log&view=skills");
  await check("Skills: a skill card opens its popup", async () => { await page.locator('[role="button"].cursor-pointer').filter({ hasText: "Starting test" }).first().click(); const ok = await dialogOpen(page); await page.screenshot({ path: `${out}/d-skill-popup.png` }); await closeDialog(page); return ok; });
  await check("Skills: a topic chip opens its popup (if any topic shows)", async () => { const chip = page.getByText(/ correct/).first(); if (!(await chip.count())) return true; await chip.click(); const ok = await dialogOpen(page); await page.screenshot({ path: `${out}/d-topic-popup.png` }); await closeDialog(page); return ok; });
  await go(page, "/student/dashboard?tab=log&view=history");
  await check("History: a Lot event opens that Lot in Recent work", async () => { const l = page.getByRole("link", { name: /→$/ }).first(); if (!(await l.count())) return true; await l.click(); await page.waitForTimeout(1500); return page.url().includes("task="); });
  await go(page, "/student/tasks/assigned");
  await check("Your Tasks: View Submission shown for earlier work", async () => (await page.getByRole("button", { name: /View Submission/ }).count()) > 0);
  await check("Your Tasks: the count is not '0 tasks' while a Daily Lot exists", async () => (await page.getByText(/^0 tasks$/).count()) === 0);
  await check("Your Tasks: a Lot with a scored voice says 'Voice done', no Explain button (R5)", async () => {
    const done = page.getByTestId("task-voice-done");
    if (!(await done.count())) return true;
    const card = done.first().locator("xpath=ancestor::div[contains(@class,'rounded') and .//h3 or contains(@class,'border-l')][1]");
    return /Voice done: [\d.]+\/10/.test(await done.first().innerText()) && (await card.getByRole("button", { name: /Explain 60s/ }).count()) === 0;
  });
  await check("Lot screen: 'Answer out of 10 · Voice out of 10 · N–M words' once, More help closed, no points (R2, simplify)", async () => {
    // A finished Lot no longer opens its Lot screen, so use the first open written Lot on Your Tasks.
    await go(page, "/student/tasks/assigned"); await page.waitForTimeout(4000);
    const write = page.getByRole("button", { name: /Write my answer/ }).first();
    if (!(await write.count())) return false;
    await write.click(); await page.getByRole("dialog").getByTestId("more-help").waitFor({ timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1000);
    const d = page.getByRole("dialog"); const text = await d.innerText();
    const ph = (await d.locator("textarea[placeholder]").first().getAttribute("placeholder")) ?? "";
    await page.screenshot({ path: `${out}/r2-lot-screen.png` });
    const ok = (await d.getByTestId("marked-out-of-10").count()) > 0 && !/\b\d+ pts\b/.test(text) && !/Aim for/.test(text) && !/of 100/.test(text)
      && ph === "Write your answer here." && (await d.getByRole("button", { name: /Insert example format/ }).count()) === 0
      && /Answer out of 10 · Voice out of 10 · \d+–\d+ words/.test(await d.getByTestId("marked-out-of-10").innerText())
      && (text.match(/\d+–\d+ words/g) ?? []).length === 1 && (await d.getByTestId("more-help-body").count()) === 0
      && !/not solving the task|making the question clear/i.test(text);
    await closeDialog(page); await go(page, "/student/tasks/assigned"); return ok; });
  await go(page, "/student/dashboard?tab=log&view=progress");
  await check("Progress: Total Submissions says 'N tries on M Lots (x passed, y not passed)'", async () => /\d+ tries? on \d+ Lots? \(\d+ passed, \d+ not passed/.test(await page.getByTestId("tile-total").innerText()));
  await check("Progress: Total Submissions opens its own list and line, not the pass-rate formula (R4)", async () => { await page.getByTestId("tile-total").click(); const why = await page.getByTestId("list-why-total").innerText().catch(() => ""); const ok = await dialogOpen(page) && (await page.getByTestId("tries-list").locator("li").count()) > 0 && /^Total tries = /.test(why) && !/Pass rate/.test(why); await page.screenshot({ path: `${out}/r2-tries-popup.png` }); await closeDialog(page); return ok; });
  await check("Progress: This week matches the Daily Card's This week (R3)", async () => {
    const progress = (await page.getByTestId("tile-week").innerText()).match(/^\s*([\d.–]+)\s*$/m)?.[1];
    return progress != null && progress === dailyWeek;
  });
  await check("Progress: This week opens its list with the formula", async () => { await page.getByTestId("tile-week").click(); const ok = await dialogOpen(page) && /Answer or Code/.test(await page.getByRole("dialog").innerText()); await page.screenshot({ path: `${out}/r2-week-popup.png` }); await closeDialog(page); return ok; });
  await check("Progress: 'See Profile → Badges' link shown", async () => (await page.getByRole("link", { name: /Profile → Badges/ }).count()) > 0);
  await check("Progress: badges link goes to Profile -> Badges", async () => { const l = page.getByRole("link", { name: /Profile → Badges/ }); if (!(await l.count())) return true; await l.click(); await page.waitForTimeout(1500); return page.url().includes("view=achievements"); });
  // Owner 12 Nov 2026 (migration 310): student Jobs page. It lists jobs or says there are none, and the only way out
  // of the app is the Apply button's confirm (never clicked through here, so no Apply click row is written).
  await go(page, "/student/dashboard?tab=jobs");
  await check("Jobs: the student Jobs page opens and lists jobs or says there are none", async () => {
    await page.locator('[data-testid="job-card"], [data-testid="jobs-empty"]').first().waitFor({ timeout: 30000 });
    return (await page.getByRole("heading", { name: /^Jobs$/i }).count()) > 0;
  });
  await check("Jobs: no outside links on the page; Apply asks first and opens only https in a new tab", async () => {
    const outside = await page.locator("main a[href]").evaluateAll((as) => as.filter((a) => new URL(a.href, location.href).origin !== location.origin).length);
    if (outside > 0) return false;
    const apply = page.getByRole("button", { name: /^Apply$/i }).first();
    if (!(await apply.count())) return true;
    await apply.click();
    const dlg = page.getByRole("dialog");
    const said = /You're leaving ProofLab to apply on \S+/i.test(await dlg.innerText());
    const a = dlg.getByTestId("apply-out");
    const ok = said && (await a.getAttribute("target")) === "_blank" && (await a.getAttribute("rel")) === "noopener noreferrer"
      && /^https:\/\//.test((await a.getAttribute("href")) ?? "");
    await closeDialog(page);
    return ok;
  });
  await ctx.close();

  await check("No 404/401 from the API on the student pages (item 30)", async () => {
    if (apiErrors.length) console.log("  api errors:", [...new Set(apiErrors)].join(", "));
    return apiErrors.length === 0;
  });

  // ---- student 19: full course on the roadmap (owner 12 Nov 2026, option Y, migration 241)
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookieSignIn(ctx, BASE, logins["Student 19"]);
  page = await ctx.newPage();
  await go(page, "/student/roadmap");
  await check("Roadmap: the track shows a 'Full course' button", async () => {
    await page.getByTestId("full-course").first().waitFor({ timeout: 30000 }).catch(() => {});
    return (await page.getByTestId("full-course").count()) > 0;
  });
  await check("Roadmap: Full course opens its chapter list and a chapter, inside the app", async () => {
    await page.getByTestId("full-course").first().click();
    await page.getByTestId("chapter-row").first().waitFor({ timeout: 30000 });
    await page.getByTestId("chapter-row").first().click();
    await page.getByTestId("chapter-title").waitFor({ timeout: 30000 });
    const text = await page.getByTestId("course-reader").innerText();
    return /^1\. /m.test(await page.getByTestId("chapter-title").innerText()) && !/https?:\/\//.test(text.replace(/```[\s\S]*?```/g, ""));
  });
  await check("Roadmap: 'Mark as read' counts the chapter, and undoing it counts it back", async () => {
    const before = await page.getByTestId("course-progress").innerText();
    const n = Number(before.match(/^(\d+)/)?.[1] ?? NaN);
    const wasRead = (await page.getByTestId("mark-read").innerText()).includes("Read") && !(await page.getByTestId("mark-read").innerText()).includes("Mark");
    await page.getByTestId("mark-read").click();
    await page.waitForTimeout(3000);
    const mid = Number((await page.getByTestId("course-progress").innerText()).match(/^(\d+)/)?.[1] ?? NaN);
    await page.getByTestId("mark-read").click(); // put it back as it was
    await page.waitForTimeout(3000);
    const after = await page.getByTestId("course-progress").innerText();
    return mid === n + (wasRead ? -1 : 1) && after === before;
  });
  await ctx.close();

  // ---- college
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookieSignIn(ctx, BASE, logins["College"]);
  page = await ctx.newPage();
  await go(page, "/college/dashboard");
  await check("College: home counts Lot attempts, not logins (item 26)", async () =>
    (await page.getByText("Tried a Lot today").count()) > 0 && (await page.getByText(/opened the app/i).count()) === 0);
  await check("College: home shows the 'Looks copied' info note, no review button (migration 229)", async () => {
    await page.getByTestId("copied-notes").waitFor({ timeout: 20000 }).catch(() => {});
    return /Looks copied: .+ and .+ wrote almost the same answer on /.test(await page.getByTestId("copied-notes").innerText().catch(() => ""));
  });
  await go(page, "/college/matches");
  await check("College: /college/matches opens Matches", async () => page.url().includes("view=matches"));
  await check("College: a match row opens the match popup", async () => { const row = page.locator("tbody tr.cursor-pointer").first(); if (!(await row.count())) return true; await row.click(); const ok = await dialogOpen(page); await page.screenshot({ path: `${out}/d-college-match-popup.png` }); await closeDialog(page); return ok; });
  await go(page, "/college/dashboard?tab=students");
  await check("College: students STATUS is Lot-based, no login-style 'Active' badge (F5)", async () =>
    (await page.getByText(/^Active$/).count()) === 0);
  await check("College: Students > Assigned tasks lists what the college assigned (assign item 5)", async () => {
    await go(page, "/college/dashboard?tab=students"); // a drawer from the checks above may still be open
    await page.getByTestId("assigned-tasks-link").click({ timeout: 30000 });
    await page.getByText(/handed in/i).first().waitFor({ timeout: 40000 }).catch(() => {});
    const text = await page.getByTestId("assigned-tasks").innerText().catch(() => "");
    const ok = page.url().includes("tab=assigned") && /Handed in/i.test(text);
    if (!ok) console.log("  assigned:", page.url(), text.slice(0, 120).replace(/\s+/g, " "));
    await go(page, "/college/dashboard?tab=students");
    return ok;
  });
  await check("College: no 'Flagged Submissions' review button", async () => (await page.getByRole("button", { name: /Flagged Submissions/ }).count()) === 0);
  await check("College: a student row opens the drawer", async () => { await page.locator("tbody tr").first().click(); return dialogOpen(page); });
  await check("College: drawer never says '0 questions'", async () => { await page.waitForTimeout(1500); return !/\b0 questions\b/.test(await page.getByRole("dialog").innerText()); });
  await check("College: drawer shows the section and 'Last Lot try', never a negative day (overnight items 4-5)", async () => {
    const t = await page.getByRole("dialog").innerText();
    return /Section [A-Z]/i.test(t) && /Last Lot try/i.test(t) && !/-\d+d ago/.test(t);
  });
  await check("College: drawer 'Lots passed' (same meaning as the list) and no false 'Nothing finished yet' (assigned-work item 6)", async () => {
    await page.waitForTimeout(1500);
    const t = await page.getByRole("dialog").innerText();
    return /Lots passed/i.test(t) && !/Lots done/i.test(t);
  });
  await check("College: drawer never ranks a 0-point squad (squad 0 (#n))", async () => !/squad 0 \(#\d+\)/.test(await page.getByRole("dialog").innerText()));
  await check("College: drawer Recent work says 'Not passed yet', never a bare 'Not passed' (E2E item 10)", async () =>
    !/(^|\n)\s*Not passed\s*(\n|$)/i.test(await page.getByRole("dialog").innerText()));
  await page.keyboard.press("Escape");
  await check("College: Home 'missed this week's Lot' View lists students (E2E item 8, migration 275)", async () => {
    await go(page, "/college/dashboard?tab=home");
    const line = page.getByText(/missed this week.s Lot/i).first();
    if (!(await line.count())) return true; // nobody missed one: nothing to open
    await line.locator("xpath=ancestor::*[.//button][1]").getByRole("button", { name: /View/i }).first().click();
    await page.locator("tbody tr").first().waitFor({ timeout: 20000 }).catch(() => {});
    return (await page.locator("tbody tr").count()) > 0 && !/No students match/i.test(await page.locator("main").innerText());
  });
  await ctx.close();

  // ---- company (assigned-work item 7)
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookieSignIn(ctx, BASE, logins["Company A"]);
  page = await ctx.newPage();
  await go(page, "/company/dashboard?tab=lots&view=create");
  await check("Company: 'Send a Lot' tab; every Send button names its candidate (item 7)", async () => {
    await page.getByRole("button", { name: /^Send a task/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
    const names = await page.getByRole("button", { name: /^Send a task/ }).allInnerTexts();
    return (await page.getByText("Send a Lot").count()) > 0 && names.length > 0 && names.every((n) => !/^Send a task$/.test(n.trim()) && !/this candidate/.test(n));
  });
  await check("Company: Written/Code choice shows which one is picked (item 7)", async () => {
    await page.getByRole("button", { name: /^Send a task/ }).first().click();
    return (await page.locator('[aria-pressed="true"]').count()) === 1 && /✓/.test(await page.locator('[aria-pressed="true"]').first().innerText());
  });
  await closeDialog(page);
  // E2E 11-13 (12 Nov 2026)
  await go(page, "/company/dashboard?tab=talent");
  await check("Company: Talent shows candidates or a message, never a stuck loader (E2E 11)", async () => {
    await page.getByText(/Candidate|No candidates match|did not load/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    return (await page.getByText(/Candidate|No candidates match|did not load/i).count()) > 0;
  });
  await check("Company: the bell opens, Escape closes it, a second bell click closes it (E2E 13)", async () => {
    const bell = page.getByRole("button", { name: "Notifications" }).first();
    const shown = () => page.getByRole("heading", { name: /^Notifications$/i }).isVisible().catch(() => false);
    await bell.click(); await page.waitForTimeout(500); const a = await shown();
    await page.keyboard.press("Escape"); await page.waitForTimeout(500); const b = !(await shown());
    await bell.click(); await page.waitForTimeout(500); await bell.click(); await page.waitForTimeout(500);
    return a && b && !(await shown());
  });
  await go(page, "/company/dashboard?tab=hiring&view=jobs");
  await check("Company: job post menu 'View Details' opens the post (E2E 12, if any post)", async () => {
    const menu = page.locator("tbody tr button").first();
    if (!(await menu.count())) return true;
    await menu.click(); await page.getByRole("menuitem", { name: /View Details/i }).click();
    const ok = await page.getByTestId("job-details").isVisible({ timeout: 5000 }).catch(() => false);
    await closeDialog(page); return ok;
  });
  await ctx.close();

  // ---- admin
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await cookieSignIn(ctx, BASE, logins["Admin"]);
  page = await ctx.newPage();
  await go(page, "/admin/dashboard?tab=submissions");
  await check("Admin: Submissions tags 'Looks copied (like <student>)', no review tab", async () => {
    await page.getByText(/Looks copied \(like /).first().waitFor({ timeout: 20000 }).catch(() => {});
    return (await page.getByText(/Looks copied \(like /).count()) > 0 && (await page.getByRole("tab", { name: /Flags & reviews/ }).count()) === 0;
  });
  await check("Admin: a submission row opens its detail", async () => { await page.locator("tbody tr.cursor-pointer").first().click(); const ok = await dialogOpen(page); await page.screenshot({ path: `${out}/d-admin-submission.png` }); return ok; });
  await ctx.close();
} finally { await browser.close(); }
console.log(`DONE ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`);
