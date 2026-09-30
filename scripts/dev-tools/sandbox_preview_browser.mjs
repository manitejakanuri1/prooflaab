// Coding (sandbox) task on the PREVIEW with the dedicated test student: Run samples, then Submit.
// STUDENT_EMAIL, STUDENT_PASSWORD (from Secret Manager) and SOLUTION (the config's reference
// solution, read by the caller with a service token) come from the environment; none is printed.
//   node scripts/dev-tools/sandbox_preview_browser.mjs <preview url> <task id> <language>
import { chromium } from 'playwright';

const [APP, TASK, LANG] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const calls = [];
page.on('response', async (r) => {
  if (/functions\/v1\/(run-sandbox|submit-sandbox-task)/.test(r.url()) && r.request().method() === 'POST') calls.push({ fn: r.url().split('/').pop(), status: r.status() });
});
try {
  await page.goto(`${APP}/auth`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', process.env.STUDENT_EMAIL);
  await page.fill('input[type="password"]', process.env.STUDENT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/student\//, { timeout: 60000 });
  await page.goto(`${APP}/student/tasks/assigned?open=${TASK}`, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Run samples/ }).waitFor({ timeout: 60000 });
  const lang = LANG === 'c' ? 'cpp' : LANG;
  const pick = (l) => window.monaco?.editor?.getEditors?.().find((e) => e.getModel()?.getLanguageId() === l && !e.getOption(window.monaco.editor.EditorOption.readOnly));
  await page.waitForFunction(pick, lang, { timeout: 60000 });
  await page.evaluate(([fn, l, code]) => new Function('l', `return (${fn})(l)`)(l).getModel().setValue(code), [pick.toString(), lang, process.env.SOLUTION]);

  await dialog.getByRole('button', { name: /Run samples/ }).click();
  await page.waitForFunction(() => true);
  await page.waitForTimeout(500);
  for (let i = 0; i < 60 && !calls.some((c) => c.fn === 'run-sandbox'); i++) await page.waitForTimeout(1000);
  const run = calls.find((c) => c.fn === 'run-sandbox');
  check('Run samples answered', run?.status === 200, `status ${run?.status}`);

  await dialog.getByRole('button', { name: /^Submit$/ }).click();
  const scoreLine = dialog.getByText(/Score \d+%/).first();
  await scoreLine.waitFor({ timeout: 120000 });
  const txt = await scoreLine.textContent();
  const sub = calls.find((c) => c.fn === 'submit-sandbox-task');
  check('Submit answered', sub?.status === 200, `status ${sub?.status}`);
  check('Submit graded and shown', /Score \d+%/.test(txt || ''), txt?.trim());
  if (process.env.EXPECT_PASS) check('passing answer shows "Passed", not "Needs"', /· Passed/.test(txt || '') && !/Needs/.test(txt || ''));
} catch (e) {
  check(`(unexpected error) ${e.message.slice(0, 200)}`, false);
  await page.screenshot({ path: `sandbox-fail-${Date.now()}.png` }).catch(() => {});
} finally {
  await browser.close();
}
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
