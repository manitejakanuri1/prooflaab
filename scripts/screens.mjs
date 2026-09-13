/**
 * Open every page at several widths and report what breaks.
 *
 * The point is not the screenshots - it is the measurement underneath. A page
 * "looking fine" is a judgement; a page being 431 pixels wide inside a 390
 * pixel phone is a fact, and it is the fact that makes a phone scroll sideways.
 *
 * For each page and width it records:
 *   overflow      how far the content runs past the screen edge
 *   widest        which element is responsible, so the fix has an address
 *   tinyText      text under 12px, which is unreadable on a phone
 *   smallTargets  buttons and links under 32px, which are hard to tap
 *
 * Usage:
 *   node scripts/screens.mjs                     against the live site
 *   node scripts/screens.mjs http://localhost:8080   against a dev server
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://prooflab.co.in';
const OUT = 'screenshots';

const WIDTHS = [
  { name: 'fold', width: 280, height: 653 },
  { name: 'phone-small', width: 360, height: 740 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-large', width: 430, height: 932 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
];

const PUBLIC_PAGES = [
  { name: 'home', path: '/' },
  { name: 'auth', path: '/auth' },
  { name: 'pricing', path: '/pricing' },
  { name: 'reset-password', path: '/reset-password' },
];

/**
 * The pages that matter most, and the ones the code scan flagged: dashboards
 * are where the tables and the fixed widths live. Each needs a signed-in
 * session, so the run logs in through the real login form first - the same path
 * a person takes, which also proves the login itself works in a browser.
 */
const PRIVATE_PAGES = {
  admin: [
    { name: 'admin-dashboard', path: '/admin/dashboard' },
    { name: 'admin-notifications', path: '/admin/notifications' },
    { name: 'review-proofs', path: '/review-proofs' },
  ],
  college: [
    { name: 'college-dashboard', path: '/college/dashboard' },
  ],
};

const LOGINS = {
  admin: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  college: { email: process.env.COLLEGE_EMAIL, password: process.env.COLLEGE_PASSWORD },
};

/**
 * Measured in the page itself, because only the browser knows the laid-out size
 * of an element. Returns plain numbers so the report can be diffed between runs.
 */
const MEASURE = () => {
  const viewport = document.documentElement.clientWidth;

  let widest = null;
  let widestPx = 0;
  for (const el of document.querySelectorAll('body *')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const right = box.right;
    if (right > widestPx) {
      widestPx = right;
      widest = el;
    }
  }

  const describe = (el) => {
    if (!el) return null;
    const cls = (el.className && typeof el.className === 'string')
      ? el.className.split(/\s+/).slice(0, 6).join(' ')
      : '';
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? ' .' + cls : ''}`.slice(0, 120);
  };

  let tinyText = 0;
  let smallTargets = 0;
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const hasOwnText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (hasOwnText && parseFloat(style.fontSize) < 12) tinyText++;

    if (['A', 'BUTTON'].includes(el.tagName) || el.getAttribute('role') === 'button') {
      const box = el.getBoundingClientRect();
      if (box.height > 0 && box.height < 32) smallTargets++;
    }
  }

  return {
    viewport,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: Math.max(0, Math.round(document.documentElement.scrollWidth - viewport)),
    widest: describe(widest),
    widestRight: Math.round(widestPx),
    tinyText,
    smallTargets,
  };
};

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const findings = [];

/** Sign in through the real form, so the session is the one a person would have. */
async function signIn(tab, who) {
  const creds = LOGINS[who];
  if (!creds?.email || !creds?.password) throw new Error(`no credentials for ${who}`);

  await tab.goto(`${BASE}/auth`, { waitUntil: 'networkidle', timeout: 45000 });
  await tab.fill('input[type="email"]', creds.email);
  await tab.fill('input[type="password"]', creds.password);
  await tab.click('button[type="submit"]');
  // Landing anywhere other than /auth means the login was accepted.
  await tab.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 45000 });
}

async function visit(tab, page, size, label) {
  const m = await tab.evaluate(MEASURE);
  await tab.screenshot({ path: `${OUT}/${page.name}-${size.name}.png`, fullPage: false });
  findings.push({ page: page.name, size: size.name, width: size.width, ...m });
  const flag = m.overflow > 0 ? `OVERFLOW +${m.overflow}px` : 'ok';
  console.log(
    `  ${page.name.padEnd(22)} ${size.name.padEnd(12)} ${String(size.width).padStart(4)}px  ` +
    `${flag.padEnd(18)} tiny:${String(m.tinyText).padStart(3)} smallTaps:${String(m.smallTargets).padStart(3)}`,
  );
  if (m.overflow > 0) console.log(`      widest: ${m.widest}`);
}

for (const page of PUBLIC_PAGES) {
  for (const size of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
    });
    const tab = await context.newPage();
    try {
      await tab.goto(`${BASE}${page.path}`, { waitUntil: 'networkidle', timeout: 45000 });
      // Give any entrance animation time to settle, or the first frame is measured.
      await tab.waitForTimeout(900);

      const m = await tab.evaluate(MEASURE);
      await tab.screenshot({
        path: `${OUT}/${page.name}-${size.name}.png`,
        fullPage: false,
      });

      findings.push({ page: page.name, size: size.name, width: size.width, ...m });

      const flag = m.overflow > 0 ? `OVERFLOW +${m.overflow}px` : 'ok';
      console.log(
        `  ${page.name.padEnd(16)} ${size.name.padEnd(12)} ${String(size.width).padStart(4)}px  ` +
        `${flag.padEnd(18)} tiny:${String(m.tinyText).padStart(3)} smallTaps:${String(m.smallTargets).padStart(3)}`,
      );
      if (m.overflow > 0) console.log(`      widest: ${m.widest}`);
    } catch (err) {
      console.log(`  ${page.name.padEnd(16)} ${size.name.padEnd(12)} FAILED: ${String(err).slice(0, 80)}`);
      findings.push({ page: page.name, size: size.name, error: String(err).slice(0, 200) });
    }
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// signed-in pages
// ---------------------------------------------------------------------------

for (const [who, pages] of Object.entries(PRIVATE_PAGES)) {
  if (!LOGINS[who]?.email) {
    console.log(`
  skipping ${who} pages - no credentials given`);
    continue;
  }
  console.log(`
  --- signed in as ${who} ---`);

  for (const size of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
    });
    const tab = await context.newPage();
    try {
      await signIn(tab, who);
      for (const page of pages) {
        await tab.goto(`${BASE}${page.path}`, { waitUntil: 'networkidle', timeout: 45000 });
        await tab.waitForTimeout(1200);
        await visit(tab, page, size, who);
      }
    } catch (err) {
      console.log(`  ${who.padEnd(22)} ${size.name.padEnd(12)} FAILED: ${String(err).slice(0, 90)}`);
      findings.push({ page: `${who}-login`, size: size.name, error: String(err).slice(0, 200) });
    }
    await context.close();
  }
}

await browser.close();
writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));

const broken = findings.filter((f) => f.overflow > 0);
console.log(`\n  ${broken.length} of ${findings.length} page/size combinations overflow`);
console.log(`  screenshots and findings.json in ${OUT}/`);
