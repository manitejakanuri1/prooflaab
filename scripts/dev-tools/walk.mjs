// node walk.mjs <email> <password> <outdir> step...
// steps: goto:/path  click:Text  clickre:regex  fill:selector=value  wait:ms  shot  text  eval:js
// Session is kept in <outdir>/state.json so later runs continue where the last stopped.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
const require = createRequire('C:/Users/manit/prooflabai-mvp/package.json');
const { chromium } = require('playwright');

const [email, password, out, ...steps] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'https://prooflab.co.in';
mkdirSync(out, { recursive: true });
const STATE = `${out}/state.json`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 },
  ...(existsSync(STATE) ? { storageState: STATE } : {}) });
const tab = await ctx.newPage();
const log = [];
tab.on('dialog', (d) => { log.push(`DIALOG ${d.message()}`); void d.accept(); });
tab.on('console', (m) => { if (m.type() === 'error') log.push(`CONSOLE ${new URL(tab.url()).pathname} :: ${m.text().slice(0, 300)}`); });
tab.on('pageerror', (e) => log.push(`PAGEERROR ${new URL(tab.url()).pathname} :: ${e.message.slice(0, 300)}`));
tab.on('response', async (r) => {
  if (r.status() >= 400) {
    let body = ''; try { body = (await r.text()).slice(0, 200); } catch {}
    log.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '').slice(0, 140)} :: ${body}`);
  }
});

if (!existsSync(STATE)) {
  await tab.goto(`${BASE}/auth`, { waitUntil: 'networkidle', timeout: 60000 });
  await tab.fill('input[type="email"]', email);
  await tab.fill('input[type="password"]', password);
  await tab.click('button[type="submit"]');
  await tab.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 60000 });
  await tab.waitForLoadState('networkidle');
}

const settle = async () => { try { await tab.waitForLoadState('networkidle', { timeout: 30000 }); } catch {} await tab.waitForTimeout(1500); };
let n = 0;
try {
  for (const s of steps) {
    const [op, ...rest] = s.split(':'); const arg = rest.join(':');
    if (op === 'goto') { await tab.goto(`${BASE}${arg}`, { waitUntil: 'networkidle', timeout: 60000 }); await settle(); }
    else if (op === 'click') { await tab.getByText(arg, { exact: true }).first().click(); await settle(); }
    else if (op === 'clickre') { await tab.getByText(new RegExp(arg, 'i')).first().click(); await settle(); }
    else if (op === 'role') { const [role, name] = arg.split('='); await tab.getByRole(role, { name: new RegExp(name, 'i') }).first().click(); await settle(); }
    else if (op === 'fill') { const [sel, ...v] = arg.split('='); await tab.fill(sel, v.join('=')); }
    else if (op === 'wait') await tab.waitForTimeout(Number(arg));
    else if (op === 'crawl') {
      // click every sidebar entry, then every tab inside it; note where each error appeared
      const navNames = await tab.locator(arg || 'aside button, aside a').evaluateAll((els) =>
        [...new Set(els.map((e) => e.innerText.trim().split(/\n/)[0].trim()).filter((t) => t && t.length < 40 && !/sign out|log ?out/i.test(t)))]);
      for (const nav of navNames) {
        const before = log.length;
        try {
          await tab.locator(arg || 'aside button, aside a').filter({ hasText: nav }).first().click({ timeout: 8000 });
          await settle(); await tab.waitForTimeout(1500);
          const tabs = await tab.locator('[role=tab]').evaluateAll((els) => els.map((e) => e.innerText.trim().split(/\n/)[0].trim()));
          for (const t of tabs) {
            try { await tab.locator('[role=tab]').filter({ hasText: t }).first().click({ timeout: 5000 }); await settle(); } catch {}
          }
          const blank = (await tab.innerText('main').catch(() => tab.innerText('body'))).trim().length < 40;
          console.log(`  ${nav}${tabs.length ? ` [${tabs.join(', ')}]` : ''}: ${log.length - before} problems${blank ? ' BLANK' : ''}`);
          for (const l of log.slice(before)) console.log(`      ${l.slice(0, 260)}`);
        } catch (e) { console.log(`  ${nav}: CLICK FAILED ${e.message.split('\n')[0]}`); }
      }
    }
    else if (op === 'clicksel') await tab.locator(arg).first().click();
    else if (op === 'upload') { const [sel, file] = arg.split('|'); await tab.setInputFiles(sel, file); await settle(); }
    else if (op === 'key') await tab.keyboard.press(arg);
    else if (op === 'type') await tab.keyboard.type(arg.replace(/\\n/g, '\n'));
    else if (op === 'shot') await tab.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}.png`, fullPage: true });
    else if (op === 'eval') console.log(await tab.evaluate(arg));
    else if (op === 'text') {
      const t = (await tab.innerText('body')).replace(/\n{2,}/g, '\n');
      console.log(`\n=== ${new URL(tab.url()).pathname}\n${t.slice(0, Number(arg) || 2500)}`);
    }
  }
} catch (e) {
  console.log('STEP FAILED:', e.message.split('\n')[0]);
  console.log((await tab.innerText('body')).replace(/\n{2,}/g, '\n').slice(0, 1500));
}
await ctx.storageState({ path: STATE });
console.log('\n=== url', tab.url(), '\n=== problems');
console.log(log.length ? [...new Set(log)].join('\n') : 'none');
await browser.close();
