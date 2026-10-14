// Written-task scratchpad (migration 48): real-browser check against STAGING or the PREVIEW.
//
// STAGING (real sign-in through the BFF; set E2E_STUDENT_EMAIL / E2E_STUDENT_PASSWORD, optional E2E_BASE):
//     node scripts/dev-tools/scratchpad_browser.mjs staging <task id> <expect: none|python|...> [submit]
// The old way (a minted token in localStorage) no longer signs anyone in. NOT RUN since this change.
// PREVIEW (real sign-in of a test student; password read from Secret Manager into memory only):
//   STUDENT_EMAIL=... STUDENT_PASSWORD=... node scripts/dev-tools/scratchpad_browser.mjs <preview url> <task id> <expect> [submit]
//
// Checks: scratchpad shown only for the expected language; Run prints the runner output;
// no task_submissions row / answer is created by Run; Submit sends only the written answer.
import { chromium } from 'playwright';
import { cookieSignIn, credentialsFor } from "./bff_login.mjs";

const [target, TASK, EXPECT, SUBMIT] = process.argv.slice(2);
const STAGING = target === 'staging';
const APP = STAGING ? (process.env.E2E_BASE ?? 'https://prooflab-staging.web.app').replace(/\/$/, '') : target.replace(/\/$/, '');
const LABEL = { python: 'Python', javascript: 'JavaScript', java: 'Java', c: 'C', cpp: 'C++', go: 'Go', ruby: 'Ruby', php: 'PHP' };

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  pageerror: ${e.message.slice(0, 160)}`));
const calls = [];
page.on('request', (r) => {
  const u = r.url();
  if (r.method() === 'POST' && /(functions\/v1|api\/functions)\/(run-code|submit-written-task)|\/task_submissions/.test(u)) calls.push({ url: u, body: r.postData() || '' });
});

try {
  // Real sign-in in both modes: the form -> /api/auth/login -> HttpOnly cookie.
  await cookieSignIn(ctx, APP, STAGING ? credentialsFor('student') : { email: process.env.STUDENT_EMAIL, password: process.env.STUDENT_PASSWORD });

  await page.goto(`${APP}/student/tasks/assigned?open=${TASK}`, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/pass mark/i).waitFor({ timeout: 60000 });
  const hasPad = await dialog.getByText(/Scratchpad$/).count();
  const runBtn = await dialog.getByRole('button', { name: /^Run$/ }).count();

  if (EXPECT === 'none') {
    check('no scratchpad on a task without scratch_language', hasPad === 0 && runBtn === 0, `scratchpad=${hasPad} run=${runBtn}`);
  } else {
    check(`"${LABEL[EXPECT]} Scratchpad" shown`, await dialog.getByText(`${LABEL[EXPECT]} Scratchpad`).count() === 1);
    check('"not marked or saved" note shown', await dialog.getByText(/For trying ideas only — not marked or saved\./).count() === 1);
    const order = await dialog.evaluate((d) => {
      const pad = [...d.querySelectorAll('p')].find((p) => /Scratchpad$/.test(p.textContent || ''));
      const ta = d.querySelector('textarea[placeholder^="Write your answer"]');
      return pad && ta ? !!(pad.compareDocumentPosition(ta) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
    });
    check('scratchpad sits above the written answer box', order);

    // Monaco loads from its CDN after the panel; type through its own model (fires the same onChange as keys).
    // The task's read-only "Given" snippet is also a Monaco editor: pick the one in the scratchpad's language.
    const pick = (lang) => window.monaco?.editor?.getEditors?.().find((e) => e.getModel()?.getLanguageId() === lang && !e.getOption(window.monaco.editor.EditorOption.readOnly));
    await page.waitForFunction(pick, EXPECT, { timeout: 60000 });
    await page.evaluate(([fn, lang]) => new Function('lang', `return (${fn})(lang)`)(lang).getModel().setValue('print("ProofLab runner OK")'), [pick.toString(), EXPECT]);
    await dialog.getByRole('button', { name: /^Run$/ }).click();
    const out = dialog.getByText('ProofLab runner OK', { exact: true });
    await out.waitFor({ timeout: 60000 });
    check('Run prints "ProofLab runner OK"', await out.count() >= 1);
    const answerAfterRun = await dialog.locator('textarea[placeholder^="Write your answer"]').inputValue();
    check('scratch code did not go into the answer box', !answerAfterRun.includes('ProofLab runner OK'));
    check('Run called run-code and nothing else', calls.length === 1 && /run-code/.test(calls[0].url), calls.map((c) => c.url.split('/').pop()).join(','));
  }

  if (SUBMIT === 'submit') {
    const words = Array.from({ length: 70 }, (_, i) => ['I', 'checked', 'each', 'line', 'of', 'the', 'transcript', 'against', 'the', 'real', 'output'][i % 11]).join(' ');
    const answer = `My written answer. ${words}. The corrected transcript now matches what the interpreter prints.`;
    await dialog.locator('textarea[placeholder^="Write your answer"]').fill(answer);
    await dialog.getByRole('button', { name: /^Submit$/ }).click();
    await dialog.getByText(/Score \d+%|Sent for review|already completed/i).first().waitFor({ timeout: 120000 });
    const sub = calls.find((c) => /submit-written-task/.test(c.url));
    const body = sub ? JSON.parse(sub.body) : null;
    check('Submit sent only {task_id, answer}', !!body && Object.keys(body).sort().join(',') === 'answer,task_id', body ? Object.keys(body).join(',') : 'no call');
    check('Submit answer is the written text, not scratch code', !!body && body.answer === answer && !body.answer.includes('print('));
    check('no direct task_submissions write from the browser', !calls.some((c) => /\/task_submissions/.test(c.url)));
    console.log('  result shown:', (await dialog.getByText(/Score \d+%|Sent for review|already completed/i).first().textContent())?.slice(0, 80));
  }
} catch (e) {
  check(`(unexpected error) ${e.message.slice(0, 200)}`, false);
  await page.screenshot({ path: `scratchpad-fail-${Date.now()}.png` }).catch(() => {});
} finally {
  await browser.close();
}
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
