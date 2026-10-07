// Step 6: real-browser STAGING check of local blob: URL ownership in
// VoiceExplainModal. Creates, changes and deletes NO database rows:
//   M1 failed save   - the upload is refused in the browser with a permanent 413 (never reaches
//                      storage/DB). A network failure is NOT a failed save any more: since audit
//                      R4-1/F5 it is "unconfirmed" and the recording is kept for resume.
//   M2 close mid-save - the upload is held, the dialog closed, then the upload aborted
//   M3 reopen         - an EXISTING finished recording is resumed from localStorage;
//                       playback must use the authenticated storagePath download
// Every blob: URL the page creates/revokes is recorded by an init script.
// Genuine Google sign-in is NOT exercised (session minted like the staging auth-bridge).
//
// Needs `npx vite --mode staging --port 5173 --strictPort` running, and:
// Tokens: signed like the staging bridge (RS256, F1) by ./staging_token.mjs - needs gcloud access to staging secrets.
//     node scripts/dev-tools/voice_modal_blob_browser.mjs <speech.wav>
import { chromium } from 'playwright';
import { mintStaging } from "./staging_token.mjs";

const WAV = process.argv[2];
const APP = 'http://localhost:5173';
const API = 'https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app';
const FILES = 'https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app/file/voice-explanations';
const T07 = '7d71bff4-1ec2-4778-b26d-9567a416bfac';

const mint = (claims, ttl = 7200) => mintStaging(claims, ttl);
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
async function openExplain(page, taskTitle) {
  await page.goto(`${APP}/student/tasks/assigned`, { waitUntil: 'domcontentloaded' });
  // Each task is a card with its title as a heading; open that task's own Explain button when one is named.
  const scope = taskTitle ? page.locator('[class*="border-l-4"]').filter({ has: page.getByRole('heading', { name: taskTitle, exact: true }) }) : page;
  await scope.getByRole('button', { name: /Explain 60s/ }).first().click({ timeout: 60000 });
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
    await page.route(`${FILES}/**`, (r) => {
      if (r.request().method() !== 'PUT') return r.continue();
      putAttempts++;
      return r.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ error: 'File too large' }) });
    });
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
    // The modal keeps one record per recording under pl.voiceJob.v3:<recordingId> (src/lib/voiceJob.ts),
    // carrying studentId/taskId - not the older pl.voiceJob.<student>.<task> keys.
    // Audit R4-3: a recording whose upload outcome is unknown is KEPT (aside), never deleted - the page
    // may only be suspended and still able to send it. So the record stays; what must hold is that
    // nothing was sent: no server job (no voiceId) and it is not marked as uploaded.
    const kept = await page.evaluate((id) => Object.keys(localStorage).filter((k) => k.startsWith('pl.voiceJob.v3:'))
      .map((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } })
      .filter((j) => j?.studentId === id), T07);
    check('M2 nothing was sent: the record is kept (R4-3) with no server job and not marked uploaded',
      kept.length === 1 && kept[0].voiceId == null && kept[0].stage !== 'uploaded',
      `records=${kept.length} voiceId=${kept[0]?.voiceId ?? null} stage=${kept[0]?.stage}`);
    await page.context().close();
  }

  // ---------- M3: reopen an existing finished recording -> storagePath playback ----------
  {
    // A finished, server-transcribed recording of t07 for a task (the modal's context is student + task;
    // staging has migration 71, so voice_explanations has no proof_id column to filter on).
    const rows = await (await fetch(`${API}/voice_explanations?student_id=eq.${T07}&transcript_source=eq.server&status=eq.scored&transcription_status=eq.completed&task_id=not.is.null&select=id,storage_path,task_id,transcription_idempotency_key&order=created_at.desc&limit=1`,
      { headers: { Authorization: `Bearer ${SVC}` } })).json();
    const rec = rows[0];
    if (!rec) throw new Error('no finished server recording of t07 to reopen');
    const [task] = await (await fetch(`${API}/tasks?id=eq.${rec.task_id}&select=id,title`, { headers: { Authorization: `Bearer ${SVC}` } })).json();
    const page = await newPage(browser, {
      // the finished job exactly as this build stores it: one per-recording record (pl.voiceJob.v3:<id>)
      fn: ({ key, job }) => localStorage.setItem(key, JSON.stringify(job)),
      arg: {
        key: `pl.voiceJob.v3:m3-${rec.id}`,
        job: { voiceId: rec.id, idempotencyKey: rec.transcription_idempotency_key ?? `existing-${rec.id}`, storagePath: rec.storage_path,
               durationSeconds: 14, studentId: T07, taskId: rec.task_id, proofId: null, recordingId: `m3-${rec.id}`,
               stage: 'uploaded', createdAt: Date.now() },
      },
    });
    const auth = [];
    page.on('request', async (r) => {
      if (!r.url().startsWith(FILES) || r.method() !== 'GET') return;
      const h = (await r.allHeaders())['authorization'] ?? '';
      auth.push(h === `Bearer ${t07Token}`);   // compared, never printed
    });
    await openExplain(page, task.title);
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
