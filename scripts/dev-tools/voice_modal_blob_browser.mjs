// Step 6: real-browser STAGING check of local blob: URL ownership in
// VoiceExplainModal. Creates, changes and deletes NO database rows:
//   M1 failed save   - the upload is blocked in the browser (never reaches storage/DB)
//   M2 close mid-save - the upload is held, the dialog closed, then the upload aborted
//   M3 reopen         - an EXISTING finished recording is resumed from localStorage;
//                       playback must use the authenticated storagePath download
// Every blob: URL the page creates/revokes is recorded by an init script.
// Genuine Google sign-in is NOT exercised (session minted like the staging auth-bridge).
//
// Needs `npx vite --mode staging --port 5173 --strictPort` running, and:
//   STAGING_JWT="$(gcloud secrets versions access latest --secret=prooflab-staging-jwt-secret)" \
//     node scripts/dev-tools/voice_modal_blob_browser.mjs <speech.wav>
import { chromium } from 'playwright';
import crypto from 'node:crypto';

const WAV = process.argv[2];
const APP = 'http://localhost:5173';
const API = 'https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app';
const FILES = 'https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app/file/voice-explanations';
const T07 = '7d71bff4-1ec2-4778-b26d-9567a416bfac';

const b64 = (b) => Buffer.from(b).toString('base64url');
function mint(claims, ttl = 7200) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ ...claims, iat: now, exp: now + ttl }));
  return `${h}.${p}.${crypto.createHmac('sha256', process.env.STAGING_JWT).update(`${h}.${p}`).digest('base64url')}`;
}
const SVC = mint({ role: 'service_role', sub: 'voice-modal-blob-test' }, 3600);
const t07Token = mint({ role: 'authenticated', sub: T07, email: 'vidyuthsetu+t07@gmail.com' });
const session = {
  access_token: t07Token, provider_token: t07Token, refresh_token: 'browser-test-no-refresh', expires_in: 7200,
  expires_at: Math.floor(Date.now() / 1000) + 7200, token_type: 'bearer',
  user: { id: T07, email: 'vidyuthsetu+t07@gmail.com', aud: 'authenticated', role: 'authenticated',
          created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(),
          app_metadata: {}, user_metadata: {}, identities: [] },
};

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

async function newPage(browser, extraInit) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem('prooflab.auth.google')) localStorage.setItem('prooflab.auth.google', JSON.stringify(s));
    const log = { created: [], revoked: [] };
    window.__blobLog = log;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (obj) => { const u = create(obj); log.created.push({ url: u, type: obj?.type ?? '' }); return u; };
    URL.revokeObjectURL = (u) => { log.revoked.push(u); return revoke(u); };
  }, session);
  if (extraInit) await ctx.addInitScript(extraInit.fn, extraInit.arg);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message.slice(0, 160)}`));
  return page;
}
const blobLog = (page) => page.evaluate(() => window.__blobLog);
const audioBlobs = (log) => log.created.filter((c) => c.type.startsWith('audio/') || c.type === '' || c.type.includes('webm') || c.type.includes('ogg'));
async function openExplain(page) {
  await page.goto(`${APP}/student/tasks/assigned`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Explain 60s/ }).first().click({ timeout: 60000 });
  await page.getByRole('dialog').waitFor({ timeout: 15000 });
}
async function recordAndStop(page, ms) {
  await page.getByRole('button', { name: /Start recording/ }).click({ timeout: 20000 });
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: /Stop and save/ }).click();
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
});
try {
  // ---------- M1: failed save (upload blocked) ----------
  {
    const page = await newPage(browser);
    let putAttempts = 0;
    await page.route(`${FILES}/**`, (r) => { if (r.request().method() === 'PUT') { putAttempts++; return r.abort('failed'); } return r.continue(); });
    await openExplain(page);
    await recordAndStop(page, 3000);
    await page.getByRole('button', { name: /Try recording again/ }).waitFor({ timeout: 30000 });
    const log = await blobLog(page);
    const made = audioBlobs(log).map((c) => c.url);
    check('M1 failed save: the recording\'s local blob URL was created and then revoked',
      made.length >= 1 && made.every((u) => log.revoked.includes(u)), `created=${made.length} revoked=${made.filter((u) => log.revoked.includes(u)).length} uploads blocked=${putAttempts}`);
    const rendered = await page.locator('[role=dialog] audio').evaluateAll((els) => els.map((e) => e.src));
    check('M1 no player left pointing at the revoked URL', rendered.every((s) => !made.includes(s)), `audio elements=${rendered.length}`);
    await page.context().close();
  }

  // ---------- M2: close while the upload is still in flight ----------
  {
    const page = await newPage(browser);
    let held = null;
    await page.route(`${FILES}/**`, (r) => { if (r.request().method() === 'PUT') { held = r; return; } return r.continue(); });
    await openExplain(page);
    await recordAndStop(page, 3000);
    await page.getByText(/Uploading your recording/).waitFor({ timeout: 30000 });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 });
    const log = await blobLog(page);
    const made = audioBlobs(log).map((c) => c.url);
    check('M2 closing the dialog revokes the local blob URL', made.length >= 1 && made.every((u) => log.revoked.includes(u)),
      `created=${made.length}`);
    if (held) await held.abort('failed');   // the upload never reaches storage
    await page.waitForTimeout(1500);
    const marker = await page.evaluate((id) => Object.keys(localStorage).filter((k) => k.startsWith(`pl.voiceJob.${id}.`)).length, T07);
    check('M2 nothing was sent: no recovery marker left (upload never completed)', marker === 0);
    await page.context().close();
  }

  // ---------- M3: reopen an existing finished recording -> storagePath playback ----------
  {
    const rows = await (await fetch(`${API}/voice_explanations?student_id=eq.${T07}&transcript_source=eq.server&status=eq.scored&transcription_status=eq.completed&select=id,storage_path,task_id&order=created_at.desc&limit=1`,
      { headers: { Authorization: `Bearer ${SVC}` } })).json();
    const tasks = await (await fetch(`${API}/tasks?student_id=eq.${T07}&select=id`, { headers: { Authorization: `Bearer ${SVC}` } })).json();
    const rec = rows[0];
    const page = await newPage(browser, {
      // the existing job, as the modal itself would have stored it (for each of t07's tasks)
      fn: ({ id, keys, job }) => { for (const k of keys) localStorage.setItem(`pl.voiceJob.${id}.${k}`, JSON.stringify(job)); },
      arg: { id: T07, keys: tasks.map((t) => t.id), job: { voiceId: rec.id, idempotencyKey: `existing-${rec.id}`, storagePath: rec.storage_path, durationSeconds: 14 } },
    });
    const auth = [];
    page.on('request', async (r) => {
      if (!r.url().startsWith(FILES) || r.method() !== 'GET') return;
      const h = (await r.allHeaders())['authorization'] ?? '';
      auth.push(h === `Bearer ${t07Token}`);   // compared, never printed
    });
    await openExplain(page);
    await page.getByText('Saved. It will appear in your build-log.').waitFor({ timeout: 60000 });
    const before = await page.locator('[role=dialog] audio').count();
    check('M3 reopened finished recording: no local blob player (nothing to point at)', before === 0);
    await page.getByRole('dialog').getByRole('button', { name: /Play recording/ }).click();
    const audio = page.getByRole('dialog').locator('audio').first();
    await audio.waitFor({ timeout: 30000 });
    const st = await audio.evaluate((a) => new Promise((res) => {
      const done = () => res({ scheme: a.src.split(':')[0], ready: a.readyState, src: a.src });
      if (a.readyState >= 1) done(); else { a.onloadedmetadata = done; a.onerror = () => res({ scheme: 'error', ready: -1, src: a.src }); setTimeout(done, 15000); }
    }));
    check('M3 playback falls back to the authenticated storagePath download', st.scheme === 'blob' && st.ready >= 1 && auth.length >= 1 && auth.every(Boolean),
      `ready=${st.ready}, ${auth.length} download(s) with the student's own Authorization header`);
    await page.getByRole('dialog').getByRole('button', { name: /^Done$/ }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 });
    const log = await blobLog(page);
    check('M3 the downloaded blob URL is revoked when the dialog closes', log.revoked.includes(st.src));
    await page.context().close();
  }
} catch (e) {
  check(`(unexpected) ${e.message.slice(0, 200)}`, false);
} finally {
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
