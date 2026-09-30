// PREVIEW: the dedicated test student's Build-Log shows a finished async recording:
// status, provenance and score badges (data-status / data-provenance / data-score) and the transcript.
// STUDENT_EMAIL / STUDENT_PASSWORD from the environment (Secret Manager); never printed.
//   node scripts/dev-tools/preview_buildlog_browser.mjs <preview url> <expected score> <transcript words>
import { chromium } from 'playwright';

const [APP, SCORE, WORDS] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const bad = [];
page.on('response', (r) => { if (r.status() >= 400 && /run\.app/.test(r.url())) bad.push(`${r.status()} ${r.url().split('.run.app')[1].split('?')[0]}`); });
page.on('console', (m) => { if (m.type() === 'error' && /CORS|blocked by/i.test(m.text())) bad.push(`console: ${m.text().slice(0, 120)}`); });
try {
  await page.goto(`${APP}/auth`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', process.env.STUDENT_EMAIL);
  await page.fill('input[type="password"]', process.env.STUDENT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/student\//, { timeout: 60000 });
  await page.goto(`${APP}/student/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Build-Log/ }).first().click({ timeout: 60000 });
  const scoreBadge = page.locator(`[data-score="${SCORE}"]`).first();
  await scoreBadge.waitFor({ timeout: 60000 });
  const card = page.locator('button[data-voice-id]', { has: page.locator(`[data-score="${SCORE}"]`) }).first();
  const status = await card.locator('[data-status]').first().getAttribute('data-status');
  const prov = await card.locator('[data-provenance]').first().getAttribute('data-provenance');
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  check(`communication score badge ${SCORE}/100 visible`, await scoreBadge.isVisible());
  check('completed state (status badge)', /scored/i.test(status || ''), `data-status=${status}`);
  check('server-verified provenance', /server/i.test(prov || ''), `data-provenance=${prov}`);
  check('transcript text visible', text.toLowerCase().includes(WORDS.toLowerCase()), text.slice(0, 120));
  await card.click();                                           // the detail view shows the whole transcript
  const detail = (await page.getByRole('dialog').innerText({ timeout: 15000 })).replace(/\s+/g, ' ');
  check('transcript in the detail view', detail.toLowerCase().includes(WORDS.toLowerCase()), detail.slice(0, 140));
  await page.keyboard.press('Escape');
  const busy = await page.locator('[data-status="transcribing"], [data-provenance="verifying"]').count();
  check('no recording stuck in pending/processing', busy === 0, `busy badges=${busy}`);
  check('no failed backend call / CORS error', bad.length === 0, bad.slice(0, 4).join('; '));
} catch (e) {
  check(`(unexpected error) ${e.message.slice(0, 200)}`, false);
  await page.screenshot({ path: `buildlog-fail-${Date.now()}.png` }).catch(() => {});
} finally {
  await browser.close();
}
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
