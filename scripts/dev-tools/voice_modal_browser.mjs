// Step 6 browser corrections: real-browser STAGING checks of VoiceExplainModal.
//
// Needs: `npx vite --mode staging --port 5173 --strictPort` running (staging
// services allow http://localhost:5173), and gcloud access to the staging signing key:
// Tokens: signed like the staging bridge (RS256, F1) by ./staging_token.mjs - needs gcloud access to staging secrets.
//     node scripts/dev-tools/voice_modal_browser.mjs <long.wav> <short.wav>
// The secret only mints short-lived tokens in memory (a t07 session like the
// staging auth-bridge issues, and a service token for read-only checks); it and
// the tokens are never printed. Real Chromium with a fake microphone playing
// the given WAV. Makes real staging recordings and a few real DeepSeek calls.
import { chromium } from 'playwright';
import { mintStaging } from "./staging_token.mjs";

const [LONG_WAV, SHORT_WAV] = process.argv.slice(2);
const APP = 'http://localhost:5173';
const API = 'https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app';
const T07 = '7d71bff4-1ec2-4778-b26d-9567a416bfac';

const mint = (claims, ttl = 7200) => mintStaging(claims, ttl);
const SVC = mint({ role: 'service_role', sub: 'voice-modal-browser-test' }, 3600);
async function rows(query) {
  const r = await fetch(`${API}/voice_explanations?${query}`, { headers: { Authorization: `Bearer ${SVC}` } });
  return r.json();
}

function session() {
  const token = mint({ role: 'authenticated', sub: T07, email: 'vidyuthsetu+t07@gmail.com' }, 7200);
  return {
    access_token: token, provider_token: token, refresh_token: 'browser-test-no-refresh',
    expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, token_type: 'bearer',
    user: {
      id: T07, email: 'vidyuthsetu+t07@gmail.com', aud: 'authenticated', role: 'authenticated',
      created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(),
      app_metadata: {}, user_metadata: {}, identities: [],
    },
  };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function withBrowser(wav, fn) {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
  });
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const s = session();
  await ctx.addInitScript((sess) => {
    if (!localStorage.getItem('prooflab.auth.google')) localStorage.setItem('prooflab.auth.google', JSON.stringify(sess));
  }, s);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message.slice(0, 160)}`));
  try {
    await fn(page, ctx);
  } catch (e) {
    check(`(unexpected error) ${e.message.slice(0, 160)}`, false);
    await page.screenshot({ path: `voice-fail-${Date.now()}.png` }).catch(() => {});
  } finally {
    await browser.close();
  }
}

async function openModal(page, taskTitle) {
  await page.goto(`${APP}/student/tasks/assigned`, { waitUntil: 'domcontentloaded' });
  // Each task is a card with its title as a heading; reopen a named task's own button (list order
  // changes once a task has a recording).
  const scope = taskTitle ? page.locator('[class*="border-l-4"]').filter({ has: page.getByRole('heading', { name: taskTitle, exact: true }) }) : page;
  const btn = scope.getByRole('button', { name: /Explain 60s/ }).first();
  await btn.waitFor({ timeout: 60000 });
  await btn.click();
  await page.getByRole('dialog').waitFor({ timeout: 15000 });
}
async function record(page, ms) {
  await page.getByRole('button', { name: /Start recording/ }).click({ timeout: 20000 });
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: /Stop and save/ }).click();
}
// The modal keeps one record per recording under pl.voiceJob.v3:<recordingId> (src/lib/voiceJob.ts),
// carrying studentId/taskId - not the older pl.voiceJob.<student>.<task> keys.
const storedJob = (page) => page.evaluate((id) => {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith('pl.voiceJob.v3:')) continue;
    const j = JSON.parse(localStorage.getItem(k));
    if (j?.studentId === id) return j;
  }
  return null;
}, T07);
const titleOf = async (taskId) =>
  (await (await fetch(`${API}/tasks?id=eq.${taskId}&select=title`, { headers: { Authorization: `Bearer ${SVC}` } })).json())[0]?.title;
const tryAgainVisible = (page) => page.getByRole('button', { name: /Try recording again/ }).isVisible();

if (!process.env.ONLY || process.env.ONLY.includes('A')) /* section A */
// ---------- A. normal + refresh mid-job: audio restored, never an empty src ----------
await withBrowser(LONG_WAV, async (page) => {
  await openModal(page);
  await record(page, 14000);
  await page.getByText(/Queued|Writing down what you said/).waitFor({ timeout: 60000 });
  const job = await storedJob(page);
  check('A1 stored job has voiceId, key, path and duration', !!(job?.voiceId && job.idempotencyKey && job.storagePath && job.durationSeconds > 0),
    `duration=${job?.durationSeconds}`);
  const title = await titleOf(job?.taskId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Heartbeat contract (voiceLifecycle.ts): a heartbeat older than 15 s means its page is gone. Reopened
  // sooner, the dialog says "still being sent from another open tab" until reopened (reported finding).
  await page.waitForTimeout(16000);
  await openModal(page, title);                             // reopen after refresh -> resume
  await page.getByText('Saved. It will appear in your build-log.').waitFor({ timeout: 120000 });
  const emptySrc = await page.locator('audio[src=""]').count();
  check('A2 no <audio> with an empty src after refresh', emptySrc === 0);
  await page.getByRole('button', { name: /Play recording/ }).click({ timeout: 15000 });
  const audio = page.locator('dialog audio, [role=dialog] audio').first();
  await audio.waitFor({ timeout: 30000 });
  const media = await audio.evaluate((a) => new Promise((res) => {
    const done = () => res({ src: a.src.slice(0, 5), ready: a.readyState, dur: a.duration });
    if (a.readyState >= 1) done(); else { a.onloadedmetadata = done; a.onerror = () => res({ src: a.src.slice(0, 5), ready: -1, dur: 0 }); setTimeout(done, 15000); }
  }));
  check('A3 audio plays after refresh (authenticated download, blob: URL)', media.src === 'blob:' && media.ready >= 1, JSON.stringify(media));
  await page.getByText(/Communication score \d+\/100/).waitFor({ timeout: 150000 });
  check('A4 server score shown after refresh', true);
  check('A5 stored job cleared once final', (await storedJob(page)) === null);
});

if (!process.env.ONLY || process.env.ONLY.includes('B')) /* section B */
// ---------- B. short recording: wait for the server's final status and feedback ----------
await withBrowser(SHORT_WAV, async (page) => {
  await openModal(page);
  await record(page, 3000);
  await page.getByText(/Queued|Writing down what you said|Saved\. It will appear/).first().waitFor({ timeout: 60000 });
  const job = await storedJob(page);   // read while in flight (cleared once final)
  await page.getByText('Saved. It will appear in your build-log.').waitFor({ timeout: 120000 });
  // Early on, a short transcript is shown but polling continues (not final from the word count).
  await page.getByText(/Too little speech to score\./).waitFor({ timeout: 150000 });
  check('B1 short recording shows the server\'s own feedback', true);
  check('B2 no "Grading" message once final', !(await page.getByText(/Grading your explanation/).isVisible()));
  let polls = 0;
  page.on('request', (r) => { if (r.url().includes('/voice_explanations') && r.method() === 'GET') polls++; });
  await page.waitForTimeout(8000);
  check('B3 polling stopped after the final status', polls === 0, `polls in 8s after final: ${polls}`);
  const dbRow = job?.voiceId ? (await rows(`id=eq.${job.voiceId}&select=status,word_count,communication_notes`))[0] : null;
  check('B4 database: short recording marked failed by the server', dbRow?.status === 'failed', JSON.stringify(dbRow));
});

if (!process.env.ONLY || process.env.ONLY.includes('C')) /* section C */
// ---------- C. lost enqueue response: server got it, browser did not hear back ----------
await withBrowser(LONG_WAV, async (page) => {
  const bodies = [];
  let first = true;
  await page.route('**/transcription-enqueue', async (route) => {
    bodies.push(JSON.parse(route.request().postData() || '{}'));
    if (first) { first = false; await route.fetch(); await route.abort('failed'); return; }  // processed, answer lost
    await route.continue();
  });
  await openModal(page);
  await record(page, 12000);
  await page.getByText('Saved. It will appear in your build-log.').waitFor({ timeout: 150000 });
  check('C1 lost response recovered without a new recording', true, `enqueue calls: ${bodies.length}`);
  check('C2 "Try recording again" never offered', !(await tryAgainVisible(page)));
  const key = bodies[0]?.idempotency_key;
  const sameKey = bodies.every((b) => b.idempotency_key === key && b.storage_path === bodies[0].storage_path && b.duration_seconds === bodies[0].duration_seconds);
  check('C3 any retry reused key, path and duration', sameKey, JSON.stringify(bodies.map((b) => b.duration_seconds)));
  const dbRows = await rows(`transcription_idempotency_key=eq.${key}&select=id`);
  check('C4 exactly one server job for that key', dbRows.length === 1, `rows=${dbRows.length}`);
});

if (!process.env.ONLY || process.env.ONLY.includes('D')) /* section D */
// ---------- D. lost response AND server unreachable for lookup/retry -> uncertain, then resume ----------
await withBrowser(LONG_WAV, async (page) => {
  const bodies = [];
  let blocked = true;
  await page.route('**/transcription-enqueue', async (route) => {
    bodies.push(JSON.parse(route.request().postData() || '{}'));
    if (bodies.length === 1) { await route.fetch(); return route.abort('failed'); }
    if (blocked) return route.abort('failed');
    return route.continue();
  });
  await page.route(/voice_explanations\?.*transcription_idempotency_key/, (route) =>
    blocked ? route.fulfill({ status: 500, body: '{"message":"test outage"}' }) : route.continue());
  await openModal(page);
  await record(page, 12000);
  await page.getByTestId('voice-uncertain').waitFor({ timeout: 60000 });
  check('D1 uncertain state offers "Resume existing recording"', await page.getByRole('button', { name: /Resume existing recording/ }).isVisible());
  check('D2 no plain "Try recording again" while uncertain', !(await tryAgainVisible(page)));
  const kept = await storedJob(page);
  check('D3 recovery details kept (key, path, duration)', !!(kept?.idempotencyKey && kept.storagePath && kept.durationSeconds > 0));
  check('D4 retried enqueue carried the original duration', bodies.length >= 2 && bodies[1].duration_seconds === bodies[0].duration_seconds,
    `first=${bodies[0]?.duration_seconds} retry=${bodies[1]?.duration_seconds}`);
  blocked = false;
  await page.getByRole('button', { name: /Resume existing recording/ }).click();
  await page.getByText('Saved. It will appear in your build-log.').waitFor({ timeout: 150000 });
  const dbRows = await rows(`transcription_idempotency_key=eq.${kept.idempotencyKey}&select=id`);
  check('D5 resume found the same job; still exactly one row', dbRows.length === 1, `rows=${dbRows.length}`);
});

if (!process.env.ONLY || process.env.ONLY.includes('E')) /* section E */
// ---------- E. progress checks keep failing -> clear message, retry, info kept ----------
await withBrowser(LONG_WAV, async (page) => {
  let failing = false;
  await page.route(/voice_explanations\?.*id=eq\./, (route) =>
    failing && !route.request().url().includes('transcription_idempotency_key')
      ? route.fulfill({ status: 503, body: '{"message":"test outage"}' }) : route.continue());
  await openModal(page);
  failing = true;
  await record(page, 12000);
  const t0 = Date.now();
  await page.getByTestId('voice-uncertain').waitFor({ timeout: 60000 });
  check('E1 failing progress checks stop with a clear message', true, `after ${Math.round((Date.now() - t0) / 1000)}s`);
  check('E2 recovery details kept while uncertain', !!(await storedJob(page))?.voiceId);
  failing = false;
  await page.getByRole('button', { name: /Resume existing recording/ }).click();
  await page.getByText('Saved. It will appear in your build-log.').waitFor({ timeout: 150000 });
  check('E3 resume after the outage completes', true);
});

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
