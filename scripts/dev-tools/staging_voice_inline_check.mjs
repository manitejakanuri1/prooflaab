// STAGING ONLY. Records one real spoken explanation through the recorder beside the answer
// (Part 2, 17 Oct 2026) on the staging website, and waits for the transcript and the score.
//   node scripts/dev-tools/staging_voice_inline_check.mjs <student email> <speech.wav>
// The student must have a coding Lot for today that already passed. Chrome's fake microphone
// plays the WAV (any 16 kHz mono PCM speech). Real cost: one transcription and one voice-score
// AI call (about Rs 1). Password from Secret Manager, never printed. Screenshots: e2e-out/voice-inline/.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { cookieSignIn } from "./bff_login.mjs";

const BASE = "https://prooflab-staging.web.app";
const [email, wav] = process.argv.slice(2);
if (!email || !wav) throw new Error("usage: <student email> <speech.wav>");
const logins = JSON.parse(execFileSync("gcloud", ["secrets", "versions", "access", "latest",
  "--secret=prooflab-staging-iso-fixture-logins", "--project=prooflab-508214"], { encoding: "utf8", shell: true }));
if (!logins[email]) throw new Error("no staging login for that address");
const OUT = "e2e-out/voice-inline";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`); };
const step = (s) => console.log(`... ${s}`);

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${resolve(wav)}`],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
try {
  await cookieSignIn(ctx, BASE, { email, password: logins[email] });
  await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByRole("button", { name: /Solve in editor/ }).click({ timeout: 60000 });
  const inline = page.getByTestId("voice-inline");
  await inline.waitFor({ timeout: 60000 });
  check("recorder is open beside the passed answer", await inline.isVisible());

  const consent = inline.getByRole("button", { name: /I understand/ });
  const startBtn = inline.getByRole("button", { name: /Start recording/ });
  // Consent is read from the server first: wait for whichever of the two appears.
  await consent.or(startBtn).first().waitFor({ timeout: 30000 });
  if (await consent.isVisible()) { step("consent"); await consent.click(); }
  await startBtn.waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${OUT}/1-ready.png` });
  step("recording 45 s");
  await startBtn.click();
  const stopBtn = inline.getByRole("button", { name: /Stop and save/ });
  await stopBtn.waitFor({ timeout: 30000 });
  check("recording started in place (no popup)", (await page.getByRole("dialog").count()) === 1);
  await page.waitForTimeout(45000);
  await page.screenshot({ path: `${OUT}/2-recording.png` });
  await stopBtn.click();

  step("waiting for transcript and score");
  const score = inline.getByText(/Communication score \d+\/100/);
  await score.waitFor({ timeout: 300000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/3-result.png`, fullPage: false });
  const text = await inline.innerText();
  check("transcript is shown", /even|total|number/i.test(text), (text.match(/[^\n]*(even|total)[^\n]*/i) || [""])[0].slice(0, 90));
  check("score is shown", await score.isVisible().catch(() => false), (text.match(/Communication score \d+\/100/) || ["no score"])[0]);
  check("still the same task page (no popup)", (await page.getByRole("dialog").count()) === 1);
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
