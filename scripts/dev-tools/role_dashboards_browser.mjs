// Read-only sign-in + dashboard load for a non-student test login (admin / college).
// EMAIL / PASSWORD from the environment (Secret Manager); never printed. Changes nothing.
//   node scripts/dev-tools/role_dashboards_browser.mjs <site> <path> <label>
import { chromium } from 'playwright';

const [APP, PATH, LABEL] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${LABEL}: ${name}${detail ? `  (${detail})` : ''}`); };
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const bad = [];
page.on('response', (r) => { if (r.status() >= 400 && /run\.app/.test(r.url())) bad.push(`${r.status()} ${r.url().split('.run.app')[1].split('?')[0]}`); });
page.on('console', (m) => { if (m.type() === 'error' && /CORS|blocked by/i.test(m.text())) bad.push(`console: ${m.text().slice(0, 120)}`); });
try {
  await page.goto(`${APP}/auth`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', process.env.EMAIL);
  await page.fill('input[type="password"]', process.env.PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30000 });
  check('sign in', true, new URL(page.url()).pathname);
  await page.goto(`${APP}${PATH}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(`${PATH} loads with content`, text.length > 200 && !/Something went wrong/i.test(text), text.slice(0, 90));
  check('no 4xx/5xx backend call or CORS error', bad.length === 0, bad.slice(0, 5).join('; '));
} catch (e) {
  check(`(unexpected error) ${e.message.slice(0, 160)}`, false);
} finally {
  await browser.close();
}
process.exit(results.every(Boolean) ? 0 : 1);
