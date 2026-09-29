// Step 6: deterministic browser tests of VoiceExplainModal driven through the
// TEST-ONLY harness (scripts/dev-tools/harness/voice-modal-harness.html), which
// lets the test change props the real pages cannot: parent open=false,
// account, task and proof changes, unmount.
//
// Nothing reaches staging except read-only GETs: uploads, enqueue, progress
// checks and consent answers are faked in the browser; every other write
// (function, RPC, insert/update/delete) is blocked and reported.
//
// Needs `npx vite --mode staging --port 5173 --strictPort` running, and:
//   STAGING_JWT="$(gcloud secrets versions access latest --secret=prooflab-staging-jwt-secret)" \
//     node scripts/dev-tools/voice_modal_harness_browser.mjs <speech.wav>
// The synchronous (legacy) save path is tested by a second run against a dev
// server started with VITE_ASYNC_TRANSCRIPTION=false and MODE=sync:
//   VITE_ASYNC_TRANSCRIPTION=false npx vite --mode staging --port 5173 --strictPort
//   MODE=sync STAGING_JWT=... node scripts/dev-tools/voice_modal_harness_browser.mjs <speech.wav>
// Genuine Google sign-in is NOT exercised (session minted like the staging auth-bridge).
import { chromium } from 'playwright';
import crypto from 'node:crypto';

const WAV = process.argv[2];
const APP = 'http://localhost:5173';
const API = 'https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app';
const FN = 'https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app';
const FILES = 'https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app/file/voice-explanations';
const TRANSCRIBER = 'https://prooflab-staging-transcriber-ysn2mpe6sa-el.a.run.app';
const MODE = process.env.MODE === 'sync' ? 'sync' : 'async';
const A = '7d71bff4-1ec2-4778-b26d-9567a416bfac';     // t07 (the signed-in session)
const B = '67c7f711-6ca8-4b4d-a586-278857dcb0ab';     // t16 (the "other account")
const TASK = 'harness-task';
const P1 = 'harness-proof-1', P2 = 'harness-proof-2';
const HARNESS = `${APP}/scripts/dev-tools/harness/voice-modal-harness.html?student=${A}&task=${TASK}`;
// the recovery/upload slot: student, task AND proof (VoiceExplainModal / voiceJob.slotKey)
const slotKey = (student, task, proof) => `pl.voiceJob.v2:${JSON.stringify([student, task ?? null, proof ?? null])}`;
const legacyKey = (student, task, proof) => `pl.voiceJob.${student}.${task ?? proof ?? 'general'}`;

const b64 = (b) => Buffer.from(b).toString('base64url');
function mint(claims, ttl = 7200) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ ...claims, iat: now, exp: now + ttl }));
  return `${h}.${p}.${crypto.createHmac('sha256', process.env.STAGING_JWT).update(`${h}.${p}`).digest('base64url')}`;
}
const tok = mint({ role: 'authenticated', sub: A, email: 'vidyuthsetu+t07@gmail.com' });
const session = {
  access_token: tok, provider_token: tok, refresh_token: 'browser-test-no-refresh', expires_in: 7200,
  expires_at: Math.floor(Date.now() / 1000) + 7200, token_type: 'bearer',
  user: { id: A, email: 'vidyuthsetu+t07@gmail.com', aud: 'authenticated', role: 'authenticated',
          created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, identities: [] },
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const blocked = [];
const CORS = { 'access-control-allow-origin': APP, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' };
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const row = (id, over = {}) => ({
  id, transcription_status: 'completed', transcript: 'I built a queue and changed polling to a lease token.',
  transcript_segments: [], word_count: 11, transcription_error: null, status: 'scored', communication_score: 77,
  communication_notes: 'Clear and specific.', storage_path: `${A}/fake-${id}.webm`,
  student_id: A, task_id: TASK, proof_id: null, transcription_idempotency_key: null, ...over,
});

async function setup(browser, opts = {}) {
  const ctx = await browser.newContext({ permissions: ['microphone'], acceptDownloads: true });
  await ctx.addInitScript(({ s, opts }) => {
    localStorage.setItem('prooflab.auth.google', JSON.stringify(s));
    const log = { created: [], revoked: [] };
    window.__blobLog = log;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o) => { const u = create(o); log.created.push({ url: u, type: o?.type ?? '' }); return u; };
    URL.revokeObjectURL = (u) => { log.revoked.push(u); return revoke(u); };
    window.__mic = { calls: 0, streams: [], gate: Promise.resolve(), release: () => {} };
    window.__holdMic = () => { window.__mic.gate = new Promise((r) => { window.__mic.release = r; }); };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { window.__mic.calls++; await window.__mic.gate; const st = await gum(c); window.__mic.streams.push(st); return st; };
    const OrigRec = window.MediaRecorder;
    window.__recorders = 0;
    window.MediaRecorder = class extends OrigRec {
      constructor(...a) { if (opts.recorderThrows) throw new DOMException('test: recorder failed', 'NotSupportedError'); super(...a); window.__recorders++; }
    };
    if (opts.audioContextThrows) window.AudioContext = class { constructor() { throw new DOMException('test: audio failed', 'NotSupportedError'); } };
    // controllable clock: Date.now() = real time + offset (simulates a throttled tab)
    const realNow = Date.now.bind(Date);
    window.__timeOffset = 0;
    Date.now = () => realNow() + window.__timeOffset;
    window.__storageThrows = 0;
    // older persisted markers, written before the page (as a previous visit/build would)
    if (!sessionStorage.getItem('__seeded')) {
      for (const [k, v] of Object.entries(opts.seed ?? {})) localStorage.setItem(k, JSON.stringify(v));
      sessionStorage.setItem('__seeded', '1');
    }
    if (opts.writeBlockVoiceStorage) {           // reads work; writes and removals throw
      for (const m of ['setItem', 'removeItem']) {
        const orig = Storage.prototype[m];
        Storage.prototype[m] = function (k, ...rest) {
          if (this === window.localStorage && typeof k === 'string' && k.startsWith('pl.voiceJob')) { window.__storageThrows++; throw new DOMException('blocked', 'QuotaExceededError'); }
          return orig.call(this, k, ...rest);
        };
      }
    }
    if (opts.decodedSeconds !== undefined) {      // SIMULATED audio length (a suspended tab kept capturing)
      AudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: opts.decodedSeconds }); };
    }
    window.__hide = () => {                      // SIMULATED hidden tab (visibilityState + event)
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    if (opts.blockVoiceStorage) {
      for (const m of ['getItem', 'setItem', 'removeItem']) {
        const orig = Storage.prototype[m];
        Storage.prototype[m] = function (k, ...rest) {
          if (typeof k === 'string' && k.startsWith('pl.voiceJob')) { window.__storageThrows++; throw new DOMException('blocked', 'SecurityError'); }
          return orig.call(this, k, ...rest);
        };
      }
    }
  }, { s: session, opts });

  const state = { putHold: null, puts: 0, enqueue: [], enqueueLost: opts.enqueueLost ?? 0, pollHold: null, rows: new Map(), autoComplete: true,
                  lookup: opts.lookup ?? 'auto', consent: { [A]: true, [B]: false, ...(opts.consent ?? {}) }, hangOnce: new Set(), hung: 0,
                  consentHold: null, consentCalls: 0, inserts: [], lookups: [] };
  for (const r of opts.rows ?? []) state.rows.set(r.id, r);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message.slice(0, 160)}`));

  await page.route(`${FILES}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.method() !== 'PUT') return route.continue();
    state.puts++;
    if (state.putHold) await state.putHold.promise;
    return json(route, 200, { path: new URL(req.url()).pathname });
  });
  await page.route(`${FN}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const name = new URL(req.url()).pathname.split('/').pop();
    if (name === 'transcription-enqueue') {
      const body = JSON.parse(req.postData() || '{}');
      if (state.enqueueLost > 0) { state.enqueueLost--; state.enqueue.push({ id: null, body, lost: true }); return route.abort('failed'); }
      const id = crypto.randomUUID();
      state.enqueue.push({ id, body });
      const owner = { task_id: body.task_id, proof_id: body.proof_id, storage_path: body.storage_path, transcription_idempotency_key: body.idempotency_key };
      state.rows.set(id, row(id, { transcription_status: 'processing', status: 'recorded', communication_score: null, ...owner }));
      if (state.autoComplete) setTimeout(() => { if (state.autoComplete) state.rows.set(id, row(id, owner)); }, 1500);
      return json(route, 200, { voice_id: id, status: 'pending' });
    }
    if (name === 'client-log') return route.fulfill({ status: 204, headers: CORS });
    if (name === 'voice-score' && MODE === 'sync') return json(route, 200, { success: true, communication_score: 70, notes: 'Sync path fake score.' });
    blocked.push(`function ${name}`);
    return route.abort('blockedbyclient');
  });
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.continue();
    if (url.pathname === '/rpc/accept_voice_consent') {        // FAKED: nothing reaches staging
      state.consentCalls++;
      if (state.consentHold) await state.consentHold.promise;
      state.consent[A] = true;                                 // the server records it for the signed-in account (A)
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (url.pathname === '/voice_explanations' && req.method() === 'POST' && MODE === 'sync') {   // FAKED sync insert
      const body = JSON.parse(req.postData() || '{}');
      const id = crypto.randomUUID();
      state.inserts.push({ id, body });
      return json(route, 201, { id });
    }
    if (url.pathname.startsWith('/rpc/') || (req.method() !== 'GET' && req.method() !== 'HEAD')) {
      blocked.push(`${req.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/student_profiles' && url.search.includes('voice_consent_at')) {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      return json(route, 200, [{ voice_consent_at: state.consent[id] ? '2026-09-01T00:00:00Z' : null }]);
    }
    if (url.pathname === '/voice_explanations') {
      const byKey = url.searchParams.get('transcription_idempotency_key')?.replace('eq.', '');
      const byPath = url.searchParams.get('storage_path')?.replace('eq.', '');
      if (byKey || byPath) {
        state.lookups.push(byKey ? `key:${byKey}` : `path:${byPath}`);
        if (state.lookup === 'hang') return;                   // never answers (route left pending)
        if (state.lookup === 'error') return json(route, 503, { message: 'test outage' });
        const hit = [...state.rows.values()].find((r) => (byKey ? r.transcription_idempotency_key === byKey : r.storage_path === byPath));
        return json(route, 200, hit ? [hit] : []);
      }
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (id && state.hangOnce.has(id)) { state.hangOnce.delete(id); state.hung++; return; }   // this one request never answers
      if (id && state.rows.has(id)) {
        if (state.pollHold) { const answer = await state.pollHold.promise; return json(route, 200, [answer ?? state.rows.get(id)]); }
        return json(route, 200, [state.rows.get(id)]);
      }
      return json(route, 200, []);
    }
    return route.continue();
  });
  await page.route(`${TRANSCRIBER}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    return json(route, 200, { text: 'I built a queue, changed polling to a lease token and tested every step twice today.', segments: [] });
  });
  await page.goto(opts.url ?? HARNESS, { waitUntil: 'domcontentloaded' });
  await page.getByRole('dialog').waitFor({ timeout: 30000 });
  return { page, state, ctx };
}
const readKey = (page, key) => ev(page, (k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }, key);
async function waitFor(fn, ms = 20000) {
  for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
const H = (page, method, ...args) => ev(page, ({ method, args }) => window.__harness[method](...args), { method, args });
const micState = (page) => ev(page, () => ({ calls: window.__mic.calls, recorders: window.__recorders,
  tracks: window.__mic.streams.flatMap((s) => s.getTracks().map((t) => t.readyState)) }));
const marker = (page, student = A, task = TASK, proof = null) => ev(page, (k) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return 'blocked'; }
}, slotKey(student, task, proof));
const startBtn = (page) => page.getByRole('button', { name: /Start recording/ });
async function recordAndStop(page, ms = 2000) {
  await startBtn(page).click({ timeout: 20000 });
  await page.getByRole('button', { name: /Stop and save/ }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: /Stop and save/ }).click();
}
async function lateMicCase(browser, label, act) {
  const { page, ctx } = await setup(browser);
  await startBtn(page).waitFor({ timeout: 20000 });
  await ev(page, () => window.__holdMic());
  await startBtn(page).click();
  await page.getByRole('button', { name: /Starting microphone/ }).waitFor({ timeout: 10000 });
  await act(page);
  await ev(page, () => window.__mic.release());
  await page.waitForTimeout(800);
  const m = await micState(page);
  check(`${label}: late microphone grant -> stream stopped, no recorder`, m.calls === 1 && m.recorders === 0 && m.tracks.length > 0 && m.tracks.every((t) => t === 'ended'), JSON.stringify(m));
  await ctx.close();
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
});
try {
 if (MODE === 'sync') {
  await syncTests(browser);
 } else {
  // ---------- microphone ----------
  await lateMicCase(browser, 'H1 parent sets open=false', (p) => H(p, 'setOpen', false));
  await lateMicCase(browser, 'H2 account change', (p) => H(p, 'setStudent', B));
  await lateMicCase(browser, 'H3 unmount', (p) => H(p, 'setMounted', false));

  for (const [label, opt] of [['H4 AudioContext fails', { audioContextThrows: true }], ['H5 MediaRecorder fails', { recorderThrows: true }]]) {
    const { page, ctx } = await setup(browser, opt);
    await startBtn(page).click({ timeout: 20000 });
    await page.getByText(/Couldn't start recording on this device/).waitFor({ timeout: 15000 });
    const m = await micState(page);
    check(`${label}: microphone released, recoverable error shown`, m.recorders === 0 && m.tracks.length > 0 && m.tracks.every((t) => t === 'ended'), JSON.stringify(m));
    await page.getByRole('button', { name: /Try recording again/ }).click();
    check(`${label}: "Try recording again" returns to Start`, await startBtn(page).isVisible());
    await ctx.close();
  }

  {
    const { page, state, ctx } = await setup(browser);
    await startBtn(page).click({ timeout: 20000 });
    await page.getByRole('button', { name: /Stop and save/ }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    // 61 s pass while the tab's timers were throttled: one late tick must stop it
    await ev(page, () => { window.__timeOffset += 61_000; });
    await page.getByText(/Uploading your recording|Queued|Writing down/).first().waitFor({ timeout: 5000 });
    for (let i = 0; i < 40 && state.enqueue.length === 0; i++) await page.waitForTimeout(250);
    check('H6 real elapsed-time limit: recorder stopped by one late tick after 61 s; length sent capped at 60',
      state.enqueue[0]?.body?.duration_seconds === 60, `duration_seconds=${state.enqueue[0]?.body?.duration_seconds}`);
    await ctx.close();
  }

  // ---------- rapid double start ----------
  {
    const { page, ctx } = await setup(browser);
    await startBtn(page).waitFor({ timeout: 20000 });
    await ev(page, () => window.__holdMic());
    await ev(page, () => { const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.includes('Start recording')); b.click(); b.click(); });
    await page.waitForTimeout(300);
    await ev(page, () => window.__mic.release());
    await page.getByRole('button', { name: /Stop and save/ }).waitFor({ timeout: 20000 });
    const m = await micState(page);
    check('H7 rapid double Start: one permission request, one recorder', m.calls === 1 && m.recorders === 1, JSON.stringify(m));
    await ctx.close();
  }

  // ---------- upload lifecycle ----------
  {
    const { page, state, ctx } = await setup(browser);
    state.putHold = deferred();
    await recordAndStop(page);
    await page.getByText(/Uploading your recording/).waitFor({ timeout: 20000 });
    await waitFor(() => state.puts === 1);                   // the upload (and its local copy) has started
    await H(page, 'setOpen', false);                       // parent closes during the upload
    const log1 = await ev(page, () => window.__blobLog);
    const local = log1.created.find((c) => c.type.includes('webm') || c.type.includes('ogg') || c.type.startsWith('audio') || c.type === '')?.url;
    check('H8 close during upload: local blob URL revoked', !!local && log1.revoked.includes(local));
    await H(page, 'setOpen', true);                          // reopen while still uploading
    await page.getByText(/Uploading your recording|still uploading/).first().waitFor({ timeout: 10000 });
    check('H9 reopen during upload: waits, no Start button', (await startBtn(page).count()) === 0);
    state.putHold.resolve();                                 // upload succeeds after the close
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 30000 });
    const audio = await page.locator('[role=dialog] audio').evaluateAll((els) => els.map((e) => e.src));
    check('H10 upload success after close: no revoked URL restored; stored-file playback offered; one upload/enqueue',
      !audio.includes(local) && (await page.getByRole('button', { name: /Play recording/ }).count()) === 1 && state.puts === 1 && state.enqueue.length === 1,
      `audio=${audio.length} uploads=${state.puts} enqueues=${state.enqueue.length}`);
    await ctx.close();
  }

  // ---------- late polls: account change, close, abandon-free replacement ----------
  {
    const { page, state, ctx } = await setup(browser);
    state.pollHold = deferred();
    await recordAndStop(page);
    for (let i = 0; i < 40 && !state.enqueue.find((e) => e.id); i++) await page.waitForTimeout(250);
    await page.waitForTimeout(500);
    const idA = state.enqueue.find((e) => e.id).id;
    await H(page, 'setStudent', B);                          // account changes with A's poll in flight
    const hold = state.pollHold; state.pollHold = null;
    hold.resolve(row(idA, { transcription_status: 'failed', transcription_error: 'STALE ANSWER', status: 'recorded', communication_score: null }));
    await page.waitForTimeout(1500);
    const mkA = await marker(page, A);
    const stale = await page.getByText('STALE ANSWER').count();
    check('H11 late poll after account change: ignored, A\'s recovery marker kept', mkA?.voiceId === idA && stale === 0);
    check('H12 account change: B is asked for consent (A\'s yes not reused)', await page.getByText('Before you record').isVisible());
    await H(page, 'setStudent', A);
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 30000 });
    check('H13 switching back to A resumes A\'s own job (context matched)', true);
    await ctx.close();
  }

  // ---------- lost enqueue answer + blocked storage: never stuck on "Uploading" ----------
  {
    const { page, state, ctx } = await setup(browser, { blockVoiceStorage: true });
    state.enqueueLost = 2;                 // first call and the automatic retry both lose their answer
    state.lookup = 'error';                // and the lookup by key fails too
    await recordAndStop(page);
    await page.getByTestId('voice-uncertain').waitFor({ timeout: 20000 });
    const keys = new Set(state.enqueue.map((e) => e.body.idempotency_key));
    check('H14 lost enqueue answers: "Resume existing recording" shown (not stuck on Uploading)', await page.getByRole('button', { name: /Resume existing recording/ }).isVisible(),
      `enqueue attempts=${state.enqueue.length}`);
    check('H15 every retry reused the same idempotency key, path and duration (no second job)', keys.size === 1 &&
      state.enqueue.every((e) => e.body.storage_path === state.enqueue[0].body.storage_path && e.body.duration_seconds === state.enqueue[0].body.duration_seconds && e.body.task_id === TASK));
    state.lookup = 'auto';
    state.enqueueLost = 0;
    // the server had in fact created the job on the first call:
    const id = crypto.randomUUID();
    state.enqueue.push({ id, body: state.enqueue[0].body });
    state.rows.set(id, row(id, { transcription_idempotency_key: state.enqueue[0].body.idempotency_key, storage_path: state.enqueue[0].body.storage_path }));
    const before = state.enqueue.length;
    await page.getByRole('button', { name: /Resume existing recording/ }).click();
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 30000 });
    const throws = await ev(page, () => window.__storageThrows);
    check('H16 resume found the existing job by its key: no new enqueue; storage was blocked throughout',
      state.enqueue.length === before && throws > 0, `storage throws=${throws}`);
    await ctx.close();
  }

  // ---------- scores and PDF export ----------
  for (const [label, over, expectNumber] of [
    ['H17 scored 77', {}, true],
    ['H18 status failed + stray 85', { status: 'failed', communication_score: 85, communication_notes: 'Too little speech to score.' }, false],
  ]) {
    const { page, state, ctx } = await setup(browser);
    state.autoComplete = false;
    await recordAndStop(page);
    for (let i = 0; i < 40 && !state.enqueue.find((e) => e.id); i++) await page.waitForTimeout(250);
    const id = state.enqueue.find((e) => e.id).id;
    state.rows.set(id, row(id, over));
    await page.getByRole('button', { name: /Download PDF/ }).waitFor({ timeout: 30000 });
    const shown = await page.getByText(/Communication score \d+\/100/).count();
    const dl = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download PDF/ }).click()]).then(([d]) => d);
    const buf = Buffer.from(await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c)));
    const text = buf.toString('latin1');
    const num = over.communication_score ?? 77;
    const inPdf = text.includes(`${num}/100`);   // exportTranscriptPdf writes "Scored NN/100" (uncompressed)
    check(`${label}: number ${expectNumber ? 'shown and exported' : 'neither shown nor exported'}`,
      expectNumber ? (shown === 1 && inPdf) : (shown === 0 && !text.includes(`${num}/100`)), `shown=${shown} pdfHasScore=${text.includes(`${num}/100`)}`);
    await ctx.close();
  }
  await newTests(browser);
 }
} catch (e) {
  check(`(unexpected) ${e.message.slice(0, 240)}`, false);
} finally {
  await browser.close();
}
console.log(`INFO  writes blocked in the browser: ${JSON.stringify([...new Set(blocked)])}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);

// ======================= correction round 3 =======================
async function newTests(browser) {
  // ---------- H19: a different proof under the same task never shares recovery ----------
  {
    const { page, state, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P1}` });
    state.autoComplete = false;
    await recordAndStop(page);
    await waitFor(() => state.enqueue.find((e) => e.id));
    const j1 = state.enqueue.find((e) => e.id);
    await H(page, 'setProof', P2);
    await startBtn(page).waitFor({ timeout: 15000 });
    const m1 = await marker(page, A, TASK, P1), m2 = await marker(page, A, TASK, P2);
    check('H19 other proof, same task: P2 offers Start (P1\'s job not resumed there); P1 marker kept with proof P1',
      m1?.voiceId === j1.id && m1?.proofId === P1 && m2 === null && j1.body.proof_id === P1,
      `P1=${JSON.stringify(m1 && { v: m1.voiceId, p: m1.proofId })} P2=${JSON.stringify(m2)}`);
    state.rows.set(j1.id, row(j1.id, { proof_id: P1 }));
    await H(page, 'setProof', P1);
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 20000 });
    check('H20 back to P1: P1\'s own job resumed', true);
    await ctx.close();
  }

  // ---------- H21-H23: simultaneous saves from different contexts ----------
  for (const [label, change] of [['proof', (p) => H(p, 'setProof', P2)], ['task', (p) => H(p, 'setTask', 'harness-task-2')], ['student', (p) => H(p, 'setStudent', B)]]) {
    const { page, state, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P1}`, consent: { [B]: true } });
    state.putHold = deferred();
    state.autoComplete = false;
    await recordAndStop(page);                                   // A's upload is held
    await waitFor(() => state.puts === 1);
    await change(page);                                          // move to context B while A uploads
    await recordAndStop(page, 1500);                             // B records and saves too
    const bothUploading = await waitFor(() => state.puts === 2, 15000);
    state.putHold.resolve();
    await waitFor(() => state.enqueue.filter((e) => e.id).length === 2, 20000);
    const [e1, e2] = state.enqueue;
    const keys = new Set(state.enqueue.map((e) => e.body.idempotency_key));
    const bodyA = state.enqueue.find((e) => e.body.proof_id === P1 && e.body.task_id === TASK && e.body.storage_path.startsWith(`${A}/`));
    const bodyB = state.enqueue.find((e) => e !== bodyA);
    const mA = await marker(page, A, TASK, P1);
    const bCtx = label === 'proof' ? [A, TASK, P2] : label === 'task' ? [A, 'harness-task-2', P1] : [B, TASK, P1];
    const mB = await marker(page, ...bCtx);
    for (const id of [e1?.id, e2?.id]) if (id) state.rows.set(id, row(id, { status: 'scored' }));
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 20000 });
    const shownPath = await page.locator('[role=dialog]').innerText();
    check(`H21 ${label} change during A's upload: B could still record and save (2 uploads, 2 enqueues)`,
      bothUploading && state.puts === 2 && state.enqueue.length === 2, `puts=${state.puts} enqueues=${state.enqueue.length}`);
    check(`H22 ${label}: unique idempotency keys; each enqueue carries its own student/task/proof`,
      keys.size === 2 && !!bodyA && !!bodyB && bodyB.body.proof_id === bCtx[2] && bodyB.body.task_id === bCtx[1] && bodyB.body.storage_path.startsWith(`${bCtx[0]}/`),
      JSON.stringify(state.enqueue.map((e) => [e.body.task_id, e.body.proof_id, e.body.storage_path.split('/')[0].slice(0, 8), e.body.idempotency_key.slice(0, 8)])));
    check(`H23 ${label}: A keeps its own recovery marker (own key/path); B's marker is B's`,
      mA?.idempotencyKey === bodyA?.body.idempotency_key && mA?.storagePath === bodyA?.body.storage_path && mA?.voiceId === bodyA?.id &&
      mB?.idempotencyKey === bodyB?.body.idempotency_key && mB?.voiceId === bodyB?.id && !shownPath.includes('STALE'),
      `A=${mA?.voiceId === bodyA?.id} B=${mB?.voiceId === bodyB?.id}`);
    await ctx.close();
  }

  // ---------- H24: an old progress check that never answers does not block the new session ----------
  {
    const { page, state, ctx } = await setup(browser);
    state.autoComplete = false;
    await recordAndStop(page);
    await waitFor(() => state.enqueue.find((e) => e.id));
    const id = state.enqueue.find((e) => e.id).id;
    // close; reopen: the reopened session's first check is made to hang forever...
    await H(page, 'setOpen', false);
    state.hangOnce.add(id);
    await H(page, 'setOpen', true);
    await waitFor(() => state.hung === 1, 10000);
    // ...then close and reopen again: the new session must make its own check
    state.rows.set(id, row(id));
    await H(page, 'setOpen', false);
    await H(page, 'setOpen', true);
    const ok = await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 15000 }).then(() => true, () => false);
    check('H24 hung progress check from an older session: new session checks on its own and shows the result', ok && state.hung === 1, `hung=${state.hung}`);
    await ctx.close();
  }

  // ---------- H25: a resume whose lookup never answers does not block the next session ----------
  {
    const k = crypto.randomUUID();
    const seed = { [slotKey(A, TASK, null)]: { voiceId: null, idempotencyKey: k, storagePath: `${A}/seeded-explain.webm`, durationSeconds: 21, studentId: A, taskId: TASK, proofId: null } };
    const { page, state, ctx } = await setup(browser, { seed, lookup: 'hang' });
    await page.getByText(/Uploading your recording/).waitFor({ timeout: 15000 });     // stuck on the hung lookup
    await waitFor(() => state.lookups.length >= 1);
    state.lookup = 'auto';
    await H(page, 'setOpen', false);
    await H(page, 'setOpen', true);
    const ok = await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 20000 }).then(() => true, () => false);
    check('H25 hung resume lookup: next session resumes by itself, retries the SAME key/path/duration once',
      ok && state.enqueue.length === 1 && state.enqueue[0].body.idempotency_key === k && state.enqueue[0].body.storage_path === `${A}/seeded-explain.webm` && state.enqueue[0].body.duration_seconds === 21,
      `enqueues=${state.enqueue.length}`);
    await ctx.close();
  }

  // ---------- H26: delayed consent acceptance never authorizes another student ----------
  {
    const { page, state, ctx } = await setup(browser, { consent: { [A]: false, [B]: false } });
    await page.getByText('Before you record').waitFor({ timeout: 15000 });
    state.consentHold = deferred();
    await page.getByRole('button', { name: /I understand/ }).click();
    await waitFor(() => state.consentCalls === 1);
    await H(page, 'setStudent', B);                                     // A's acceptance still in flight
    await page.waitForTimeout(500);
    state.consentHold.resolve();                                        // A's answer arrives while B is shown
    await page.waitForTimeout(1000);
    const bAsked = await page.getByText('Before you record').isVisible();
    const bStart = await startBtn(page).count();
    const bSaving = await page.getByRole('button', { name: /Saving…/ }).count();
    const m = await micState(page);
    check('H26 A\'s late "I understand" after switching to B: B still asked, no Start, no microphone',
      bAsked && bStart === 0 && bSaving === 0 && m.calls === 0, `asked=${bAsked} start=${bStart} saving=${bSaving} mic=${m.calls}`);
    await H(page, 'setStudent', A);                                     // A re-reads its own (now given) consent
    const aStart = await startBtn(page).waitFor({ timeout: 15000 }).then(() => true, () => false);
    check('H27 back to A: A\'s own consent (read from the server) allows Start', aStart);
    await ctx.close();
  }

  // ---------- H28-H32: older (legacy) recovery markers ----------
  const legacySeed = (k, extra = {}) => ({ [legacyKey(A, TASK, P2)]: { voiceId: null, idempotencyKey: k, storagePath: `${A}/1700000000000-explain.webm`, durationSeconds: 20, ...extra } });
  const url2 = `${HARNESS}&proof=${P2}`;
  {
    const k = crypto.randomUUID();
    const other = row('legacy-row-p1', { proof_id: P1, transcription_idempotency_key: k });
    const { page, state, ctx } = await setup(browser, { url: url2, seed: legacySeed(k), rows: [other] });
    await startBtn(page).waitFor({ timeout: 15000 });
    const kept = await readKey(page, legacyKey(A, TASK, P2));
    check('H28 legacy marker whose server row is another proof (same task): not attached, marker untouched, Start offered',
      kept?.idempotencyKey === k && state.enqueue.length === 0 && (await marker(page, A, TASK, P2)) === null, `lookups=${state.lookups.join(',')}`);
    await ctx.close();
  }
  {
    const k = crypto.randomUUID();
    const { page, state, ctx } = await setup(browser, { url: url2, seed: legacySeed(k) });
    await page.getByTestId('voice-legacy').waitFor({ timeout: 15000 });
    const attach = await page.getByRole('button', { name: /save it here/ }).count();
    const kept = await readKey(page, legacyKey(A, TASK, P2));
    check('H29 legacy marker unknown to the server: explicit choice shown; no enqueue; marker untouched; key AND path checked',
      attach === 1 && state.enqueue.length === 0 && kept?.idempotencyKey === k && state.lookups.some((l) => l.startsWith('key:')) && state.lookups.some((l) => l.startsWith('path:')),
      `lookups=${state.lookups.length}`);
    await page.getByRole('button', { name: /save it here/ }).click();
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 20000 });
    const moved = await marker(page, A, TASK, P2);
    check('H30 "save it here" (explicit): one enqueue with the SAME key/path/duration and THIS proof; moved to the new slot',
      state.enqueue.length === 1 && state.enqueue[0].body.idempotency_key === k && state.enqueue[0].body.proof_id === P2 && state.enqueue[0].body.duration_seconds === 20 &&
      (await readKey(page, legacyKey(A, TASK, P2))) === null && (moved === null || moved.idempotencyKey === k), `enqueues=${state.enqueue.length}`);
    await ctx.close();
  }
  {
    const k = crypto.randomUUID();
    const { page, state, ctx } = await setup(browser, { url: url2, seed: legacySeed(k), lookup: 'error' });   // set before the page loads
    await page.getByTestId('voice-legacy').waitFor({ timeout: 15000 });
    const attach = await page.getByRole('button', { name: /save it here/ }).count();
    check('H31 legacy marker, server check fails: no attach offered, no enqueue, marker untouched',
      attach === 0 && state.enqueue.length === 0 && (await readKey(page, legacyKey(A, TASK, P2)))?.idempotencyKey === k);
    await page.getByRole('button', { name: /Keep it aside/ }).click();
    await startBtn(page).waitFor({ timeout: 10000 });
    const aside = await readKey(page, `pl.voiceJob.setAside:${k}`);
    check('H32 "keep it aside": details kept under a set-aside key (not deleted), Start offered',
      aside?.idempotencyKey === k && (await readKey(page, legacyKey(A, TASK, P2))) === null && state.enqueue.length === 0);
    await ctx.close();
  }
  {
    const k = crypto.randomUUID();
    const mine = row('legacy-row-p2', { proof_id: P2, transcription_idempotency_key: k });
    const { page, state, ctx } = await setup(browser, { url: url2, seed: legacySeed(k), rows: [mine] });
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 20000 });
    check('H33 legacy marker proven this proof\'s by the server: resumed without any new enqueue; old key retired',
      state.enqueue.length === 0 && (await readKey(page, legacyKey(A, TASK, P2))) === null);
    await ctx.close();
  }

  // ---------- H34-H35: reads work, writes/removals blocked ----------
  {
    const oldK = crypto.randomUUID();
    const seed = { [slotKey(A, TASK, null)]: { voiceId: null, idempotencyKey: oldK, storagePath: `${A}/old-explain.webm`, durationSeconds: 30, studentId: A, taskId: TASK, proofId: null } };
    const { page, state, ctx } = await setup(browser, { seed, writeBlockVoiceStorage: true, lookup: 'error', enqueueLost: 1 });
    await page.getByTestId('voice-uncertain').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: /Abandon it/ }).click();
    await H(page, 'setOpen', false);
    await H(page, 'setOpen', true);
    await startBtn(page).waitFor({ timeout: 15000 });
    const persisted = await readKey(page, slotKey(A, TASK, null));
    const oldAttempts = state.enqueue.length;
    check('H34 removal blocked: abandoned job does not come back on reopen (persisted copy still there)',
      persisted?.idempotencyKey === oldK && (await page.getByTestId('voice-uncertain').count()) === 0, `persisted=${!!persisted}`);
    state.lookup = 'auto'; state.enqueueLost = 1;                // new recording: answer lost once, write blocked
    await recordAndStop(page);
    await page.getByText(/Communication score 77\/100/).waitFor({ timeout: 30000 });
    const newer = state.enqueue.slice(oldAttempts);
    check('H35 write blocked: the newer recording\'s in-memory marker wins over the old persisted one (retry used the NEW key only)',
      newer.length === 2 && newer.every((e) => e.body.idempotency_key !== oldK && e.body.idempotency_key === newer[0].body.idempotency_key),
      `attempts=${newer.length} throws=${await ev(page, () => window.__storageThrows)}`);
    await ctx.close();
  }

  // ---------- H36-H37: recording length (SIMULATED hidden tab / suspended capture) ----------
  {
    const { page, state, ctx } = await setup(browser);
    await startBtn(page).click({ timeout: 20000 });
    await page.getByRole('button', { name: /Stop and save/ }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await ev(page, () => window.__hide());
    await waitFor(() => state.enqueue.length === 1, 15000);
    const d = state.enqueue[0]?.body.duration_seconds;
    check('H36 SIMULATED hidden tab: recording stopped and saved at once (not left running)', typeof d === 'number' && d <= 3, `duration_seconds=${d}`);
    await ctx.close();
  }
  {
    const { page, state, ctx } = await setup(browser, { decodedSeconds: 75 });
    await recordAndStop(page, 1500);
    await page.getByText(/ran past 60 seconds/).waitFor({ timeout: 15000 });
    check('H37 SIMULATED 75 s of decoded audio: refused - nothing uploaded, nothing enqueued', state.puts === 0 && state.enqueue.length === 0);
    await ctx.close();
  }
}

// ======================= synchronous (legacy) save path =======================
async function syncTests(browser) {
  // S1: simultaneous saves from two proofs; each inserts once with its own context
  const { page, state, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P1}` });
  state.putHold = deferred();
  await recordAndStop(page);
  await waitFor(() => state.puts === 1);
  await H(page, 'setProof', P2);
  await recordAndStop(page, 1500);
  const both = await waitFor(() => state.puts === 2, 20000);
  state.putHold.resolve();
  await page.getByText(/Communication score 70\/100/).waitFor({ timeout: 30000 });
  await waitFor(() => state.inserts.length === 2, 10000);
  await page.waitForTimeout(1500);
  const proofs = state.inserts.map((i) => i.body.proof_id).sort();
  check('S1 sync path: A\'s save in flight did not swallow B\'s (2 uploads, 2 inserts)', both && state.puts === 2 && state.inserts.length === 2,
    `puts=${state.puts} inserts=${state.inserts.length}`);
  check('S2 sync path: each insert carries its own proof (P1, P2), same task and student',
    JSON.stringify(proofs) === JSON.stringify([P1, P2]) && state.inserts.every((i) => i.body.task_id === TASK && i.body.student_id === A));
  check('S3 sync path: B\'s screen shows B\'s saved result', await page.getByText(/Saved\. It will appear/).isVisible());
  await ctx.close();
}
