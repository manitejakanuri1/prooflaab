// STAGING ONLY. Browser check of the Skip-path skills test up to the coding round (Part 3,
// 17 Oct 2026) on the real staging website, as a fresh SIM12 test student who has not done intake.
//   node scripts/dev-tools/staging_test_coding_round_check.mjs <fresh student email>
// Welcome -> Skip -> pick interest + skills + goal -> review -> quiz (first option / short answer)
// -> coding round: checks the title, the full-screen split and the phone layout, then stops
// without submitting any code. Makes real AI calls (interest review, questions, quiz grading,
// coding problems): about Rs 1-2. Password from Secret Manager, never printed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { cookieSignIn } from "./bff_login.mjs";

const BASE = "https://prooflab-staging.web.app";
const email = process.argv[2];
if (!email) throw new Error("usage: <fresh student email>");
const logins = JSON.parse(execFileSync("gcloud", ["secrets", "versions", "access", "latest",
  "--secret=prooflab-staging-iso-fixture-logins", "--project=prooflab-508214"], { encoding: "utf8", shell: true }));
if (!logins[email]) throw new Error("no staging login for that address");
const OUT = "e2e-out/test-coding-round";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`); };
const step = (s) => console.log(`... ${s}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
try {
  await cookieSignIn(ctx, BASE, { email, password: logins[email] });
  await page.goto(`${BASE}/student/start`, { waitUntil: "networkidle", timeout: 90000 });

  // A rerun may already be past Welcome / Skip: click whichever screen shows up.
  const welcome = page.getByRole("button", { name: /^Start$/ }), skip = page.getByRole("button", { name: /Skip/ });
  await welcome.or(skip).or(page.locator('label[for="Web Development"]')).first().waitFor({ timeout: 60000 });
  if (await welcome.isVisible()) { step("welcome"); await welcome.click(); }
  await skip.or(page.locator('label[for="Web Development"]')).first().waitFor({ timeout: 60000 });
  if (await skip.isVisible()) { step("skip"); await skip.click(); }

  step("wizard: interest");
  await page.locator('label[for="Web Development"]').click({ timeout: 60000 });
  await page.getByRole("button", { name: /^Next$/ }).click();
  step("wizard: skills + goal");
  await page.locator('label[for="JavaScript"]').click({ timeout: 30000 });
  await page.locator('label[for="React"]').click();
  await page.locator("#careerGoals").fill("I want to become a full stack web developer");
  await page.getByRole("button", { name: /Complete Setup/ }).click();

  step("review (AI)");
  const start = page.getByRole("button", { name: /Start the test|Start anyway/ });
  await start.waitFor({ timeout: 120000 });
  await page.screenshot({ path: `${OUT}/1-review.png` });
  await start.click();

  step("quiz");
  const dialog = page.getByRole("dialog");
  // The coding round's own title, inside the test dialog (the page behind also says "a coding round").
  const codingTitle = dialog.getByText("Coding round", { exact: true });
  await dialog.waitFor({ timeout: 120000 });
  const title = await dialog.locator("h2").first().innerText();
  check("test title says Prove your skills", /Prove your skills/.test(title), title.split("\n")[0]);
  await page.screenshot({ path: `${OUT}/2-quiz.png` });

  for (let i = 0; i < 25; i++) {
    if (await codingTitle.isVisible().catch(() => false)) break;
    const next = dialog.getByRole("button", { name: /^(Next|Submit & finish)$/ });
    if (!(await next.isVisible().catch(() => false))) { await page.waitForTimeout(2000); continue; }
    const radio = dialog.getByRole("radio").first();
    if (await radio.isVisible().catch(() => false)) await radio.click();
    else await dialog.locator("textarea").first().fill("I would split it into small functions, test each one with sample input, and check the edge cases such as empty input.").catch(() => {});
    const sure = dialog.locator("button[aria-pressed]").first();
    if (await sure.isVisible().catch(() => false)) await sure.click().catch(() => {});
    const last = /Submit/.test(await next.innerText());
    await next.click();
    step(`answered question ${i + 1}${last ? " (submit)" : ""}`);
    await page.waitForTimeout(last ? 3000 : 300);
  }

  step("coding round (AI)");
  await codingTitle.waitFor({ timeout: 240000 });
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/3-coding-desktop.png` });

  const d = await page.getByRole("dialog").boundingBox();
  check("coding round fills the screen", d && d.width >= 1400 && d.height >= 860, d && `${Math.round(d.width)}x${Math.round(d.height)}`);
  const heading = await codingTitle.boundingBox();
  const ed = await page.locator(".monaco-editor").first().boundingBox();
  check("problem on the left, editor on the right", heading && ed && ed.x > heading.x + 400, heading && ed && `problem x ${Math.round(heading.x)}, editor x ${Math.round(ed.x)}`);
  check("timer is shown", await page.getByRole("dialog").getByText(/\d+:\d\d/).first().isVisible());
  for (const name of [/Run sample/, /^Skip$/, /Submit & next|Finish/]) {
    const b = page.getByRole("button", { name }).first();
    const bb = await b.boundingBox().catch(() => null);
    check(`button ${name.source} visible on screen`, bb && bb.y + bb.height <= 900 && bb.x > 700, bb && `at ${Math.round(bb.x)},${Math.round(bb.y)}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/4-coding-phone-top.png` });
  const h2 = await codingTitle.boundingBox();
  const ed2 = await page.locator(".monaco-editor").first().boundingBox();
  check("phone: editor below the problem", h2 && ed2 && ed2.y > h2.y + 50, h2 && ed2 && `problem y ${Math.round(h2.y)}, editor y ${Math.round(ed2.y)}`);
  check("phone: no sideways scrolling", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.getByRole("button", { name: /Run sample/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/5-coding-phone-buttons.png` });
} catch (e) {
  console.log(`FAIL stopped: ${String(e.message).split("\n")[0]}`);
  results.push(false);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
