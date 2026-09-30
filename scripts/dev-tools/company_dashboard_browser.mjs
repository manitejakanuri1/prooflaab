// Read-only company (startup/recruiter) smoke test on a live site with the TEST company login.
// Signs in, opens Home / Talent / Work / Jobs, and checks admin and college pages stay closed.
// Clicks navigation only - never posts, applies, shortlists or saves anything.
// EMAIL / PASSWORD from the environment (Secret Manager); never printed.
//   node scripts/dev-tools/company_dashboard_browser.mjs https://prooflab.co.in
import { chromium } from 'playwright';

const [APP] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  company: ${name}${detail ? `  (${detail})` : ''}`); };
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
let bad = [];
page.on('response', (r) => { if (r.status() >= 400 && /run\.app/.test(r.url())) bad.push(`${r.status()} ${r.url().split('.run.app')[1].split('?')[0]}`); });
page.on('console', (m) => { if (m.type() === 'error' && /CORS|blocked by/i.test(m.text())) bad.push(`console: ${m.text().slice(0, 120)}`); });
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
try {
  await page.goto(`${APP}/auth`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', process.env.EMAIL);
  await page.fill('input[type="password"]', process.env.PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  check('sign in lands on the company dashboard', new URL(page.url()).pathname.startsWith('/company'), new URL(page.url()).pathname);

  for (const tab of ['Home', 'Talent', 'Work', 'Jobs']) {
    bad = [];
    await page.getByRole('button', { name: tab, exact: true }).first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    const t = await body();
    const main = (await page.locator('main').first().innerText().catch(() => t)).replace(/\s+/g, ' ');
    check(`${tab} opens with content`, main.length > 40 && !/Something went wrong|Couldn't load|Failed to load/i.test(t), main.slice(0, 110));
    check(`${tab}: no 4xx/5xx backend call or CORS error`, bad.length === 0, bad.slice(0, 4).join('; '));
  }

  for (const path of ['/admin/dashboard', '/college/dashboard', '/student/dashboard']) {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const where = new URL(page.url()).pathname;
    const t = await body();
    const leaked = /Student Trace|Bug Finder|Token Usage|Import students|Daily Card|Insights/i.test(t) && where === path;
    check(`${path} is closed to a company`, where !== path || !leaked, `ended on ${where}`);
  }
} catch (e) {
  check(`(unexpected error) ${e.message.slice(0, 160)}`, false);
} finally {
  await browser.close();
}
process.exit(results.every(Boolean) ? 0 : 1);
