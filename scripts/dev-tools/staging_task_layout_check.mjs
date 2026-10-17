// STAGING ONLY. Browser check of the full-screen task page and the voice column beside the answer
// (Part 2, 17 Oct 2026) on the real staging website, signed in as a SIM12 test student.
//   node scripts/dev-tools/staging_task_layout_check.mjs <student email> <reference answer file>
// The student must have a coding Lot for today. The password is read from Secret Manager and never
// printed. Nothing is recorded (no voice upload, so no AI call); the only write is the student's own
// code submission, graded by the code runner. Screenshots go to e2e-out/task-layout/.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { cookieSignIn } from "./bff_login.mjs";

const BASE = "https://prooflab-staging.web.app";
const [email, answerFile] = process.argv.slice(2);
if (!email || !answerFile) throw new Error("usage: <student email> <reference answer file>");
const gcloud = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
const logins = JSON.parse(execFileSync(gcloud, ["secrets", "versions", "access", "latest",
  "--secret=prooflab-staging-iso-fixture-logins", "--project=prooflab-508214"], { encoding: "utf8", shell: true }));
const password = logins[email];
if (!password) throw new Error("no staging login for that address");
const answer = readFileSync(answerFile, "utf8");
const OUT = "e2e-out/task-layout";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`); };
const box = async (loc) => (await loc.count()) ? loc.first().boundingBox() : null;

const browser = await chromium.launch();
try {
  // Desktop: locked panel, submit, unlocked in place.
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desk.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await cookieSignIn(desk, BASE, { email, password });
  const page = await desk.newPage();
  await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle", timeout: 90000 });
  const solve = page.getByRole("button", { name: /Solve in editor/ });
  await solve.waitFor({ timeout: 60000 });
  await solve.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/1-desktop-locked.png` });

  const dlg = await box(dialog);
  check("task page fills the screen", dlg && dlg.width >= 1400 && dlg.height >= 860, dlg && `${Math.round(dlg.width)}x${Math.round(dlg.height)}`);
  const locked = page.getByTestId("voice-locked");
  check("voice panel is shown and locked before submit", await locked.isVisible());
  const ed = await box(page.locator(".monaco-editor")), lk = await box(locked);
  check("voice panel sits to the right of the editor", ed && lk && lk.x > ed.x + ed.width - 5, ed && lk && `editor ends ${Math.round(ed.x + ed.width)}, voice starts ${Math.round(lk.x)}`);
  check("no 'Next: explain it' button any more", (await page.getByRole("button", { name: /Next: explain it/ }).count()) === 0);

  // Type the answer like a person: select all, delete, insert the text in one go (no auto-indent).
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  // Pasted, as a person would from their own notes: typing would be auto-indented by the editor.
  await page.evaluate((t) => navigator.clipboard.writeText(t), answer);
  await page.keyboard.press("Control+V");
  await page.getByRole("button", { name: /^Submit$/ }).click();
  const inline = page.getByTestId("voice-inline");
  await inline.waitFor({ timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/2-desktop-unlocked.png` });
  check("after a pass the recorder opens in place", await inline.isVisible());
  check("locked message is gone", !(await locked.isVisible().catch(() => false)));
  check("still one task page, no popup on top", (await page.getByRole("dialog").count()) === 1);
  const passed = await dialog.innerText();
  check("result shows the pass", /passed|all tests|tests passed|\d+\s*\/\s*\d+/i.test(passed));
  await desk.close();

  // Phone: everything stacked, voice last.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await cookieSignIn(phone, BASE, { email, password });
  const p2 = await phone.newPage();
  await p2.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle", timeout: 90000 });
  await p2.getByRole("button", { name: /Solve in editor/ }).click();
  await p2.locator(".monaco-editor").first().waitFor({ timeout: 60000 });
  await p2.waitForTimeout(1500);
  await p2.screenshot({ path: `${OUT}/3-phone-top.png` });
  const ped = await box(p2.locator(".monaco-editor")), pv = await box(p2.getByTestId("voice-inline").or(p2.getByTestId("voice-locked")));
  check("phone: voice panel is below the editor", ped && pv && pv.y > ped.y, ped && pv && `editor y ${Math.round(ped.y)}, voice y ${Math.round(pv.y)}`);
  const wide = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("phone: no sideways scrolling", !wide);
  await p2.getByTestId("voice-inline").or(p2.getByTestId("voice-locked")).first().scrollIntoViewIfNeeded();
  await p2.screenshot({ path: `${OUT}/4-phone-voice.png` });
  await phone.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
