import { createRequire } from 'node:module';
const require = createRequire('C:/Users/manit/prooflabai-mvp/package.json');
const { chromium } = require('playwright');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: 'e2e/state.json' });
const p = await ctx.newPage(); const log = [];
p.on('pageerror', e => log.push('PAGEERROR ' + e.message.slice(0, 200)));
p.on('response', async r => { if (r.status() >= 400) log.push(`HTTP ${r.status()} ${r.url().replace(/\?.*/, '').slice(0, 120)}`); });
await p.goto('https://prooflab.co.in/student/resume-onboarding', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
const start = p.getByRole('button', { name: /Start assessment|Resume|Continue assessment/i });
if (await start.count()) { await start.first().click(); }
let last = '';
for (let i = 0; i < 80; i++) {
  await p.waitForTimeout(1200);
  const body = await p.innerText('body');
  const m = body.match(/Question (\d+) of (\d+)/);
  if (!m) { if (i > 5) break; continue; }
  if (m[0] === last) continue;
  const card = p.locator('div', { hasText: m[0] }).last();
  const ta = p.locator('textarea');
  if (await ta.count() && await ta.first().isVisible()) {
    await ta.first().fill('I would split the problem into small functions, test each with sample inputs, handle edge cases such as empty or invalid input, and then combine them and test the whole program again.');
  } else {
    const dlg = p.locator('[role=dialog]').last();
    const btns = dlg.locator('button:visible');
    const texts = await btns.allInnerTexts();
    const qi = texts.findIndex(t => t.trim().length > 1 && !/^(next|submit|finish|close)$/i.test(t.trim()) && !/^[😎🤔😬]$/u.test(t.trim()));
    if (qi >= 0) await btns.nth(qi).click();
  }
  const conf = p.locator('[role=dialog]').last().getByRole('button', { name: '🤔' });
  if (await conf.count()) await conf.first().click().catch(() => {});
  const next = p.getByRole('button', { name: /^(Next|Submit|Finish)/i });
  if (await next.count()) { await next.first().click().catch(() => {}); console.log('answered', m[0]); last = m[0]; }
}
console.log('waiting for grading...');
await p.waitForTimeout(60000);
await p.screenshot({ path: 'e2e/assessment-after.png', fullPage: true });
console.log('\nAFTER:', (await p.innerText('body')).replace(/\n{2,}/g, '\n').slice(0, 1800));
console.log('url', p.url()); console.log('problems', [...new Set(log)]);
await ctx.storageState({ path: 'e2e/state.json' }); await b.close();
