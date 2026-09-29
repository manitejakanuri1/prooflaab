// Step 6: deterministic real-browser checks of VoiceExplainModal lifecycle and
// concurrency. EVERY write is faked or blocked in the browser - no upload, no
// enqueue, no row reaches staging:
//   - files-service PUT            -> faked 200 (optionally held, then released)
//   - transcription-enqueue        -> faked { voice_id }
//   - voice_explanations GET by id -> scripted rows (optionally held)
//   - any other function call, table insert/update/delete -> blocked and reported
// The microphone is the real fake-device one, behind a gate the test controls.
// Only reads (the page's own GETs and read-only RPCs) reach staging.
//
// Needs `npx vite --mode staging --port 5173 --strictPort` running, and:
//   STAGING_JWT="$(gcloud secrets versions access latest --secret=prooflab-staging-jwt-secret)" \
//     node scripts/dev-tools/voice_modal_lifecycle_browser.mjs <speech.wav>
// Genuine Google sign-in is NOT exercised (session minted like the staging auth-bridge).
import { chromium } from 'playwright';
import crypto from 'node:crypto';

const WAV = process.argv[2];
const APP = 'http://localhost:5173';
const API = 'https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app';
const FN = 'https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app';
const FILES = 'https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app/file/voice-explanations';
const T07 = '7d71bff4-1ec2-4778-b26d-9567a416bfac';

const b64 = (b) => Buffer.from(b).toString('base64url');
function mint(claims, ttl = 7200) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ ...claims, iat: now, exp: now + ttl }));
  return `${h}.${p}.${crypto.createHmac('sha256', process.env.STAGING_JWT).update(`${h}.${p}`).digest('base64url')}`;
}
const tok = mint({ role: 'authenticated', sub: T07, email: 'vidyuthsetu+t07@gmail.com' });
const session = {
  access_token: tok, provider_token: tok, refresh_token: 'browser-test-no-refresh', expires_in: 7200,
  expires_at: Math.floor(Date.now() / 1000) + 7200, token_type: 'bearer',
  user: { id: T07, email: 'vidyuthsetu+t07@gmail.com', aud: 'authenticated', role: 'authenticated',
          created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, identities: [] },
};

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const blockedWrites = [];
const READ_ONLY_RPCS = new Set(['my_rank', 'my_todays_lot']);
const rpcCalls = new Set();

const CORS = { 'access-control-allow-origin': APP, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' };
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const row = (id, over = {}) => ({
  id, transcription_status: 'completed', transcript: 'I built a queue and changed polling to a lease token.',
  transcript_segments: [], word_count: 11, transcription_error: null, status: 'scored', communication_score: 77,
  communication_notes: 'Clear and specific.', storage_path: `${T07}/fake-${id}.webm`, ...over,
});

/** Scriptable fakes for one page. */
async function setup(browser, { blockVoiceStorage = false, consentError = false } = {}) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript(({ s, blockVoiceStorage }) => {
    if (!localStorage.getItem('prooflab.auth.google')) localStorage.setItem('prooflab.auth.google', JSON.stringify(s));
    // blob URL log
    const log = { created: [], revoked: [] };
    window.__blobLog = log;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o) => { const u = create(o); log.created.push({ url: u, type: o?.type ?? '' }); return u; };
    URL.revokeObjectURL = (u) => { log.revoked.push(u); return revoke(u); };
    // microphone behind a gate
    window.__mic = { calls: 0, streams: [], gate: Promise.resolve(), release: () => {} };
    window.__holdMic = () => { window.__mic.gate = new Promise((r) => { window.__mic.release = r; }); };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.__mic.calls++;
      await window.__mic.gate;
      const st = await gum(c);
      window.__mic.streams.push(st);
      return st;
    };
    // recorder counter
    const Orig = window.MediaRecorder;
    window.__recorders = 0;
    window.MediaRecorder = class extends Orig { constructor(...a) { super(...a); window.__recorders++; } };
    // optionally: storage throws for the recovery marker keys
    window.__storageThrows = 0;
    if (blockVoiceStorage) {
      for (const m of ['getItem', 'setItem', 'removeItem']) {
        const orig = Storage.prototype[m];
        Storage.prototype[m] = function (k, ...rest) {
          if (typeof k === 'string' && k.startsWith('pl.voiceJob')) { window.__storageThrows++; throw new DOMException('blocked', 'SecurityError'); }
          return orig.call(this, k, ...rest);
        };
      }
    }
  }, { s: session, blockVoiceStorage });

  const state = { putHold: null, putCount: 0, enqueue: [], pollHold: null, rows: new Map(), owner: new Map(), autoComplete: true };
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message.slice(0, 160)}`));

  await page.route(`${FILES}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.method() !== 'PUT') return route.continue();
    state.putCount++;
    if (state.putHold) await state.putHold.promise;
    return json(route, 200, { path: new URL(req.url()).pathname });   // faked: nothing stored
  });
  await page.route(`${FN}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const name = new URL(req.url()).pathname.split('/').pop();
    if (name === 'transcription-enqueue') {
      const body = JSON.parse(req.postData() || '{}');
      const id = crypto.randomUUID();
      state.enqueue.push({ id, body });
      // the row's own owner fields, as the real server returns them (the modal checks them, audit F8)
      state.owner.set(id, { student_id: T07, task_id: body.task_id ?? null, proof_id: body.proof_id ?? null,
        storage_path: body.storage_path, transcription_idempotency_key: body.idempotency_key });
      if (!state.rows.has(id)) state.rows.set(id, row(id, { transcription_status: 'processing', status: 'recorded', communication_score: null }));
      // the fake "server" finishes the job 1.5 s later (unless the test scripts the row itself)
      if (state.autoComplete) setTimeout(() => { if (state.autoComplete) state.rows.set(id, row(id)); }, 1500);
      return json(route, 200, { voice_id: id, status: 'pending' });
    }
    if (name === 'client-log') return route.fulfill({ status: 204, headers: CORS });
    blockedWrites.push(`function ${name}`);
    return route.abort('blockedbyclient');
  });
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.continue();
    if (url.pathname.startsWith('/rpc/')) {
      const fn = url.pathname.slice(5);
      // Only known read-only RPCs go through; anything else (e.g. touch_my_activity,
      // which updates last_active) is answered locally and reported.
      if (READ_ONLY_RPCS.has(fn)) { rpcCalls.add(fn); return route.continue(); }
      blockedWrites.push(`rpc ${fn}`);
      return json(route, 200, null);
    }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') { blockedWrites.push(`${req.method()} ${url.pathname}`); return route.abort('blockedbyclient'); }
    if (url.pathname === '/student_profiles' && url.search.includes('voice_consent_at') && consentError) return json(route, 500, { message: 'test outage' });
    if (url.pathname === '/voice_explanations') {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (url.searchParams.get('transcription_idempotency_key')) return json(route, 200, []);
      if (id && state.rows.has(id)) {
        if (state.pollHold) {
          const hold = state.pollHold;
          const respond = await hold.promise;            // the test decides what arrives, and when
          return json(route, 200, [{ ...(respond ?? state.rows.get(id)), ...state.owner.get(id) }]);
        }
        return json(route, 200, [{ ...state.rows.get(id), ...state.owner.get(id) }]);
      }
    }
    return route.continue();
  });
  return { page, state, ctx };
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
async function openExplain(page, { first = true } = {}) {
  if (first) await page.goto(`${APP}/student/tasks/assigned`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Explain 60s/ }).first().click({ timeout: 60000 });
  await page.getByRole('dialog').waitFor({ timeout: 15000 });
}
const closeDialog = async (page) => { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 }); };
const marker = (page) => ev(page, (id) => {
  // one record per recording: pl.voiceJob.v3:<recording id>, holding its student/task/proof (voiceJob.markerKey)
  try {
    const mine = Object.keys(localStorage).filter((k) => k.startsWith('pl.voiceJob.v3:'))
      .map((k) => JSON.parse(localStorage.getItem(k) || 'null')).filter((j) => j && j.studentId === id);
    mine.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    if (mine[0]) return mine[0];
  } catch { /* blocked */ }
  return null;
}, T07);
async function recordAndStop(page, ms = 2000) {
  await page.getByRole('button', { name: /Start recording/ }).click({ timeout: 20000 });
  await page.getByRole('button', { name: /Stop and save/ }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: /Stop and save/ }).click();
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
});
try {
  // ---------- L1: microphone permission arrives after the dialog closed ----------
  {
    const { page, ctx } = await setup(browser);
    await openExplain(page);
    await page.getByRole('button', { name: /Start recording/ }).waitFor({ timeout: 20000 });
    await ev(page, () => window.__holdMic());
    await page.getByRole('button', { name: /Start recording/ }).click();
    await page.getByRole('button', { name: /Starting microphone/ }).waitFor({ timeout: 10000 });
    await closeDialog(page);
    await ev(page, () => window.__mic.release());
    await page.waitForTimeout(800);
    const m = await ev(page, () => ({ calls: window.__mic.calls, recorders: window.__recorders,
      states: window.__mic.streams.flatMap((s) => s.getTracks().map((t) => t.readyState)) }));
    check('L1 late microphone grant after close: stream stopped at once, no recorder started',
      m.calls === 1 && m.recorders === 0 && m.states.length > 0 && m.states.every((s) => s === 'ended'), JSON.stringify(m));
    await ctx.close();
  }

  // ---------- L2: rapid double Start ----------
  {
    const { page, state, ctx } = await setup(browser);
    await openExplain(page);
    await page.getByRole('button', { name: /Start recording/ }).waitFor({ timeout: 20000 });
    await ev(page, () => window.__holdMic());
    await ev(page, () => {
      const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.includes('Start recording'));
      b.click(); b.click();   // two clicks in the same tick
    });
    await page.waitForTimeout(300);
    await ev(page, () => window.__mic.release());
    await page.getByRole('button', { name: /Stop and save/ }).waitFor({ timeout: 20000 });
    const m = await ev(page, () => ({ calls: window.__mic.calls, recorders: window.__recorders }));
    check('L2 rapid double Start: one microphone request, one recorder', m.calls === 1 && m.recorders === 1, JSON.stringify(m));
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Stop and save/ }).click();
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 30000 });
    check('L2 the single recording completes normally (faked upload/enqueue, scripted poll)', state.putCount === 1 && state.enqueue.length === 1,
      `uploads=${state.putCount} enqueues=${state.enqueue.length}`);
    await ctx.close();
  }

  // ---------- L3: close during an upload that later succeeds; reopen uses stored-file playback ----------
  {
    const { page, state, ctx } = await setup(browser);
    state.putHold = deferred();
    await openExplain(page);
    await recordAndStop(page);
    await page.getByText(/Uploading your recording/).waitFor({ timeout: 20000 });
    // wait until the upload (and its local copy) has really started: "Uploading" shows first
    for (let i = 0; i < 80 && state.putCount === 0; i++) await page.waitForTimeout(250);
    await closeDialog(page);
    const afterClose = await ev(page, () => window.__blobLog);
    const localUrl = afterClose.created.find((c) => c.type.startsWith('audio') || c.type.includes('webm') || c.type === '')?.url;
    check('L3 closing during upload revokes the local blob URL', !!localUrl && afterClose.revoked.includes(localUrl));
    state.putHold.resolve();                 // the upload now succeeds, after the dialog closed
    for (let i = 0; i < 40 && !(await marker(page))?.voiceId; i++) await page.waitForTimeout(250);
    const mk = await marker(page);
    check('L3 the save still finished after close: marker with the job id was written', !!mk?.voiceId && state.enqueue.length === 1);
    await openExplain(page, { first: false });
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 30000 });
    const audio = await page.locator('[role=dialog] audio').evaluateAll((els) => els.map((e) => e.src));
    const playBtn = await page.getByRole('dialog').getByRole('button', { name: /Play recording/ }).count();
    check('L3 reopened: no revoked URL in the player; authenticated stored-file playback offered',
      audio.length === 0 && playBtn === 1 && !audio.includes(localUrl), `audio=${audio.length} playButton=${playBtn}`);
    await ctx.close();
  }

  // ---------- L4: reopen while the upload is still running ----------
  {
    const { page, state, ctx } = await setup(browser);
    state.putHold = deferred();
    await openExplain(page);
    await recordAndStop(page);
    await page.getByText(/Uploading your recording/).waitFor({ timeout: 20000 });
    await closeDialog(page);
    await openExplain(page, { first: false });
    await page.getByText(/Uploading your recording|still uploading/).first().waitFor({ timeout: 10000 });
    const startVisible = await page.getByRole('button', { name: /Start recording/ }).count();
    const recordersBefore = await ev(page, () => window.__recorders);
    check('L4 reopened during upload: waits for it, no Start button (no second recording)', startVisible === 0, `start buttons=${startVisible}`);
    state.putHold.resolve();
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 30000 });
    const recordersAfter = await ev(page, () => window.__recorders);
    check('L4 the in-flight save is picked up and finishes; still one upload, one enqueue, one recorder',
      state.putCount === 1 && state.enqueue.length === 1 && recordersAfter === recordersBefore && recordersBefore === 1,
      `uploads=${state.putCount} enqueues=${state.enqueue.length} recorders=${recordersAfter}`);
    await ctx.close();
  }

  // ---------- L5: a stale poll answer after close must not touch the UI or the marker ----------
  {
    const { page, state, ctx } = await setup(browser);
    await openExplain(page);
    state.pollHold = deferred();              // the first progress check hangs
    await recordAndStop(page);
    for (let i = 0; i < 40 && state.enqueue.length === 0; i++) await page.waitForTimeout(250);
    await page.waitForTimeout(500);           // the held poll request is now in flight
    await closeDialog(page);
    const id = state.enqueue[0].id;
    const staleAnswer = row(id, { transcription_status: 'failed', transcription_error: 'STALE ANSWER', status: 'recorded', communication_score: null });
    const hold = state.pollHold;
    state.pollHold = null;
    hold.resolve(staleAnswer);                // arrives after close
    await page.waitForTimeout(1500);
    const mk = await marker(page);
    check('L5 stale poll answer after close did not clear the recovery marker', mk?.voiceId === id);
    await openExplain(page, { first: false });
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 30000 });
    const staleShown = await page.getByText('STALE ANSWER').count();
    check('L5 reopened: current answer shown, stale "failed" never displayed', staleShown === 0);
    await ctx.close();
  }

  // ---------- L6: blocked localStorage - recovery still works within the page ----------
  {
    const { page, state, ctx } = await setup(browser, { blockVoiceStorage: true });
    state.putHold = deferred();
    await openExplain(page);
    await recordAndStop(page);
    await page.getByText(/Uploading your recording/).waitFor({ timeout: 20000 });
    await closeDialog(page);
    state.putHold.resolve();
    for (let i = 0; i < 40 && state.enqueue.length === 0; i++) await page.waitForTimeout(250);
    await page.waitForTimeout(500);
    await openExplain(page, { first: false });
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 30000 });
    const throws = await ev(page, () => window.__storageThrows);
    check('L6 localStorage blocked (every access threw): close/reopen still resumed the job from memory',
      throws > 0 && state.enqueue.length === 1, `storage throws=${throws}`);
    await ctx.close();
  }

  // ---------- L7: a number only when the server says scored ----------
  {
    const { page, state, ctx } = await setup(browser);
    state.autoComplete = false;
    await openExplain(page);
    await recordAndStop(page);
    for (let i = 0; i < 40 && state.enqueue.length === 0; i++) await page.waitForTimeout(250);
    const id = state.enqueue[0].id;
    state.rows.set(id, row(id, { status: 'failed', communication_score: 85, communication_notes: 'Too little speech to score.' }));
    await page.getByText('Too little speech to score.').waitFor({ timeout: 30000 });
    const shown = await page.getByText(/Communication score/).count();
    check('L7 inconsistent record (status failed + score 85): feedback shown, no number', shown === 0);
    await ctx.close();
  }

  // ---------- L8: consent cannot be read -> ask again, never assume yes ----------
  {
    const { page, ctx } = await setup(browser, { consentError: true });
    await openExplain(page);
    const asked = await page.getByText('Before you record').isVisible();
    const startShown = await page.getByRole('button', { name: /Start recording/ }).count();
    check('L8 consent lookup fails: consent is asked again, no Start button', asked && startShown === 0);
    await ctx.close();
  }
} catch (e) {
  check(`(unexpected) ${e.message.slice(0, 220)}`, false);
} finally {
  await browser.close();
}
// Report (not a pass/fail): what the fakes blocked, and which RPCs the page itself called.
// The proof that nothing was written is the row count taken before and after the run.
console.log(`INFO  writes blocked in the browser: ${JSON.stringify(blockedWrites)}`);
console.log(`INFO  RPCs the page called (allowed through): ${JSON.stringify([...rpcCalls])}`);
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
