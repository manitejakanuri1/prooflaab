// PREVIEW checks with the dedicated test student: Roadmap opens cleanly, and one async voice
// recording (fake microphone playing <wav>) is saved and queued. The caller then follows the
// row in the database to the server transcript and score.
// STUDENT_EMAIL / STUDENT_PASSWORD come from the environment (Secret Manager); never printed.
//   node scripts/dev-tools/preview_roadmap_voice_browser.mjs <preview url> <wav>
import { chromium } from 'playwright';

const [APP, WAV] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
});
const ctx = await browser.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
const bad = [];
page.on('response', (r) => { if (r.status() >= 400 && /run\.app/.test(r.url())) bad.push(`${r.status()} ${r.url().split('.run.app')[1].split('?')[0]}`); });
page.on('console', (m) => { if (m.type() === 'error' && /CORS|blocked by/i.test(m.text())) bad.push(`console: ${m.text().slice(0, 120)}`); });
const calls = [];
page.on('request', (r) => { if (r.method() === 'POST' && /transcription-enqueue|\/transcribe\b|voice-score/.test(r.url())) calls.push(r.url().split('/').pop()); });

try {
  await page.goto(`${APP}/auth`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', process.env.STUDENT_EMAIL);
  await page.fill('input[type="password"]', process.env.STUDENT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/student\//, { timeout: 60000 });

  // ---- Roadmap
  await page.goto(`${APP}/student/roadmap`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const txt = await page.locator('body').innerText();
  check('Roadmap shows no error message', !/Couldn't start that path|Something went wrong/i.test(txt));
  check('Roadmap shows the Python path', /Python/i.test(txt));
  check('Roadmap: no failed backend call / CORS error', bad.length === 0, bad.slice(0, 4).join('; '));

  // ---- Voice (skip with NO_VOICE=1: roadmap-only smoke, no new recording)
  if (process.env.NO_VOICE) throw Object.assign(new Error('skip'), { skip: true });
  bad.length = 0;
  await page.goto(`${APP}/student/tasks/assigned`, { waitUntil: 'domcontentloaded' });
  const btn = page.getByRole('button', { name: /Explain 60s/ }).first();
  await btn.waitFor({ timeout: 60000 });
  await btn.click();
  await page.getByRole('dialog').waitFor({ timeout: 15000 });
  const consent = page.getByRole('button', { name: /I understand — continue/ });   // first recording only
  if (await consent.waitFor({ timeout: 10000 }).then(() => true, () => false)) await consent.click();
  console.log('  dialog:', (await page.getByRole('dialog').innerText()).replace(/\s+/g, ' ').slice(0, 160));
  await page.getByRole('button', { name: /Start recording/ }).click({ timeout: 20000 });
  await page.waitForTimeout(16000);
  await page.getByRole('button', { name: /Stop and save/ }).click();
  await page.getByText(/Queued|Writing down what you said|Saved/).first().waitFor({ timeout: 90000 });
  check('recording uploaded and queued (async path)', calls.includes('transcription-enqueue') && !calls.includes('transcribe'), calls.join(','));
  const shown = page.getByText(/Communication|\/100|Saved\. It will appear/).first();
  await shown.waitFor({ timeout: 240000 }).catch(() => {});
  console.log('  screen after processing:', (await page.getByRole('dialog').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200));
  check('voice: no failed backend call / CORS error', bad.length === 0, bad.slice(0, 4).join('; '));
} catch (e) {
  if (!e.skip) check(`(unexpected error) ${e.message.slice(0, 200)}`, false);
  if (!e.skip) await page.screenshot({ path: `preview-voice-fail-${Date.now()}.png` }).catch(() => {});
} finally {
  await browser.close();
}
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
