// Step 6: deterministic browser tests of VoiceExplainModal driven through the
// TEST-ONLY harness (scripts/dev-tools/harness/voice-modal-harness.html), which
// lets the test change what the real pages cannot: parent open=false, the
// signed-in session together with the student (setAccount), task and proof
// changes, unmount - and open several tabs that share one browser storage.
//
// Nothing reaches staging except read-only GETs of unrelated page data: the file
// service (upload AND download), enqueue, progress rows, lookups, consent read
// and accept, the sync insert, voice-score and the transcriber are faked in the
// browser; every other write (function, RPC, insert/update/delete) is blocked
// and reported. Every faked request records which account's token it carried.
//
// Needs `npx vite --mode staging --port 5173 --strictPort` running, and:
//   STAGING_JWT="$(gcloud secrets versions access latest --secret=prooflab-staging-jwt-secret)" \
//     node scripts/dev-tools/voice_modal_harness_browser.mjs <speech.wav>
// The synchronous (legacy) save path is tested by a second run against a dev
// server started with VITE_ASYNC_TRANSCRIPTION=false and MODE=sync:
//   VITE_ASYNC_TRANSCRIPTION=false npx vite --mode staging --port 5173 --strictPort
//   MODE=sync STAGING_JWT=... node scripts/dev-tools/voice_modal_harness_browser.mjs <speech.wav>
// ONLY=<regex> runs just the matching groups. Genuine Google sign-in is NOT
// exercised (sessions are minted like the staging auth-bridge issues them).
import { chromium } from 'playwright';
import crypto from 'node:crypto';

const WAV = process.argv[2];
const APP = 'http://localhost:5173';
const API = 'https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app';
const FN = 'https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app';
const FILES = 'https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app/file/voice-explanations';
const TRANSCRIBER = 'https://prooflab-staging-transcriber-ysn2mpe6sa-el.a.run.app';
const MODE = process.env.MODE === 'sync' ? 'sync' : 'async';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const A = '7d71bff4-1ec2-4778-b26d-9567a416bfac';     // t07
const B = '67c7f711-6ca8-4b4d-a586-278857dcb0ab';     // t16
const TASK = 'harness-task';
const P1 = 'harness-proof-1', P2 = 'harness-proof-2';
const HARNESS = `${APP}/scripts/dev-tools/harness/voice-modal-harness.html?student=${A}&task=${TASK}`;
// records of the previous builds (read for migration only)
const v2Key = (student, task, proof) => `pl.voiceJob.v2:${JSON.stringify([student, task ?? null, proof ?? null])}`;
const legacyKey = (student, task, proof) => `pl.voiceJob.${student}.${task ?? proof ?? 'general'}`;
const v3Key = (id) => `pl.voiceJob.v3:${id}`;

const b64 = (b) => Buffer.from(b).toString('base64url');
function mint(claims, ttl = 7200) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ ...claims, iat: now, exp: now + ttl }));
  return `${h}.${p}.${crypto.createHmac('sha256', process.env.STAGING_JWT).update(`${h}.${p}`).digest('base64url')}`;
}
const sessionFor = (id, email) => {
  const tok = mint({ role: 'authenticated', sub: id, email });
  return {
    access_token: tok, provider_token: tok, refresh_token: 'browser-test-no-refresh', expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200, token_type: 'bearer',
    user: { id, email, aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(),
            last_sign_in_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, identities: [] },
  };
};
const SESSIONS = { [A]: sessionFor(A, 'vidyuthsetu+t07@gmail.com'), [B]: sessionFor(B, 'vidyuthsetu+t16@gmail.com') };
const subOf = (auth) => {
  try { return JSON.parse(Buffer.from((auth ?? '').replace(/^Bearer /, '').split('.')[1], 'base64url').toString()).sub ?? null; } catch { return null; }
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

function newState(opts) {
  const state = {
    putHold: null, putMode: null, puts: [], uploaded: new Set(), gets: [], enqueue: [], enqueueLost: opts.enqueueLost ?? 0,
    pollHold: null, rows: new Map(), owner: new Map(), autoComplete: true, lookup: opts.lookup ?? 'auto',
    consent: { [A]: true, [B]: false, ...(opts.consent ?? {}) }, hangOnce: new Set(), hung: 0,
    consentHold: null, consentCalls: 0, inserts: [], lookups: [], transcribeHold: null, requests: [],
  };
  for (const r of opts.rows ?? []) state.rows.set(r.id, r);
  return state;
}
// a row as the server would return it: test-set fields, then the enqueue's own owner fields
const rowOf = (state, id) => ({ ...state.rows.get(id), ...(state.owner.get(id) ?? {}) });

async function setup(browser, opts = {}) {
  const ctx = await browser.newContext({ permissions: ['microphone'], acceptDownloads: true });
  await ctx.addInitScript(({ s, sessions, opts }) => {
    if (location.protocol === 'about:') return;          // a blank page left to (F9): nothing to set up
    localStorage.setItem('prooflab.auth.google', JSON.stringify(s));
    window.__sessions = sessions;
    const log = { created: [], revoked: [] };
    window.__blobLog = log;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o) => { const u = create(o); log.created.push({ url: u, type: o?.type ?? '' }); return u; };
    URL.revokeObjectURL = (u) => { log.revoked.push(u); return revoke(u); };
    window.__mic = { calls: 0, streams: [], gate: Promise.resolve(), release: () => {} };
    window.__holdMic = () => { window.__mic.gate = new Promise((r) => { window.__mic.release = r; }); };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { window.__mic.calls++; await window.__mic.gate; const st = await gum(c); window.__mic.streams.push(st); return st; };
    // Recorders are numbered; the events of the ones listed in opts.holdRecorders are
    // queued until window.__releaseRecorder(n) (a DELAYED old MediaRecorder event).
    const OrigRec = window.MediaRecorder;
    window.__recorders = 0;
    window.__recs = [];
    window.__recQueues = {};
    window.__releaseRecorder = (n) => { const q = window.__recQueues[n] ?? []; window.__recQueues[n] = null; for (const f of q) f(); };
    window.MediaRecorder = class extends OrigRec {
      constructor(...a) {
        if (opts.recorderThrows) throw new DOMException('test: recorder failed', 'NotSupportedError');
        super(...a);
        const n = ++window.__recorders;
        window.__recs.push(this);
        if ((opts.holdRecorders ?? []).includes(n)) {
          window.__recQueues[n] = [];
          let da = null, st = null;
          Object.defineProperty(this, 'ondataavailable', { get: () => da, set: (h) => { da = h; } });
          Object.defineProperty(this, 'onstop', { get: () => st, set: (h) => { st = h; } });
          const later = (fn) => (e) => { const q = window.__recQueues[n]; if (q) q.push(() => fn(e)); else fn(e); };
          this.addEventListener('dataavailable', later((e) => da?.(e)));
          this.addEventListener('stop', later((e) => st?.(e)));
        }
      }
    };
    if (opts.audioContextThrows) window.AudioContext = class { constructor() { throw new DOMException('test: audio failed', 'NotSupportedError'); } };
    // controllable clock: Date.now() = real time (or a frozen instant) + offset
    const realNow = Date.now.bind(Date);
    window.__timeOffset = opts.timeOffset ?? 0;
    Date.now = () => (opts.frozenNow ?? realNow()) + window.__timeOffset;
    window.__storageThrows = 0;
    // older persisted records, written once before the first page (as a previous visit/build would)
    if (!localStorage.getItem('__seeded')) {
      for (const [k, v] of Object.entries(opts.seed ?? {})) localStorage.setItem(k, JSON.stringify(v));
      localStorage.setItem('__seeded', '1');
    }
    const blockVoice = (methods, name) => {
      for (const m of methods) {
        const orig = Storage.prototype[m];
        Storage.prototype[m] = function (k, ...rest) {
          if (this === window.localStorage && typeof k === 'string' && k.startsWith('pl.voiceJob')) { window.__storageThrows++; throw new DOMException('blocked', name); }
          return orig.call(this, k, ...rest);
        };
      }
    };
    if (opts.writeBlockVoiceStorage) blockVoice(['setItem', 'removeItem'], 'QuotaExceededError');   // reads work
    if (opts.setBlockVoiceStorage) blockVoice(['setItem'], 'QuotaExceededError');                    // reads AND removals work
    if (opts.blockVoiceStorage) blockVoice(['getItem', 'setItem', 'removeItem'], 'SecurityError');
    if (opts.decodedSeconds !== undefined) {      // SIMULATED audio length (a suspended tab kept capturing)
      AudioContext.prototype.decodeAudioData = function () { return Promise.resolve({ duration: opts.decodedSeconds }); };
    }
    window.__hide = () => {                      // SIMULATED hidden tab (visibilityState + event)
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
  }, { s: SESSIONS[A], sessions: SESSIONS, opts });
  const state = newState(opts);
  const page = await addPage(ctx, state, opts);
  return { page, state, ctx };
}

/** A tab in the same browser (shares localStorage), with the same fakes and state. */
async function addPage(ctx, state, opts = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message.slice(0, 160)}`));
  page.on('dialog', (d) => { state.dialogs = [...(state.dialogs ?? []), d.type()]; void d.accept(); });
  const note = (req, extra = {}) => state.requests.push({ sub: subOf(req.headers().authorization), method: req.method(), url: req.url(), ...extra });

  await page.route(`${FILES}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = decodeURIComponent(new URL(req.url()).pathname.replace(/^\/file\/voice-explanations\//, ''));
    note(req, { path });
    if (req.method() === 'GET') {                      // FAKED download (existence check / playback)
      state.gets.push(path);
      if (state.uploaded.has(path)) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'audio/webm' }, body: Buffer.from([26, 69, 223, 163]) });
      return json(route, 404, { error: 'not found' });
    }
    if (req.method() !== 'PUT') { blocked.push(`files ${req.method()}`); return route.abort('blockedbyclient'); }
    const size = req.postDataBuffer()?.length ?? 0;
    state.puts.push({ path, size, sub: subOf(req.headers().authorization) });
    if (state.putHold) await state.putHold.promise;
    const mode = state.putMode;
    if (mode === 'hang') return;                                        // never answers
    if (mode === 'abort') { state.putMode = null; return route.abort('failed'); }          // nothing stored, no answer
    if (mode === 'store-then-abort') { state.putMode = null; state.uploaded.add(path); return route.abort('failed'); }  // stored, answer lost
    if (mode === 'refuse') return json(route, 413, { error: 'That file is too large' });
    if (state.uploaded.has(path)) return json(route, 409, { error: 'A file already exists at that path' });
    state.uploaded.add(path);
    return json(route, 200, { path });
  });
  await page.route(`${FN}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const name = new URL(req.url()).pathname.split('/').pop();
    note(req, { fn: name, body: req.postData() });
    if (name === 'transcription-enqueue') {
      const body = JSON.parse(req.postData() || '{}');
      const sub = subOf(req.headers().authorization);
      if (state.enqueueLost > 0) { state.enqueueLost--; state.enqueue.push({ id: null, body, sub, lost: true }); return route.abort('failed'); }
      const id = crypto.randomUUID();
      state.enqueue.push({ id, body, sub });
      state.owner.set(id, { student_id: sub, task_id: body.task_id, proof_id: body.proof_id, storage_path: body.storage_path, transcription_idempotency_key: body.idempotency_key });
      state.rows.set(id, row(id, { transcription_status: 'processing', status: 'recorded', communication_score: null }));
      if (state.autoComplete) setTimeout(() => { if (state.autoComplete) state.rows.set(id, row(id)); }, 1500);
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
    note(req, { body: req.postData() });
    if (url.pathname === '/rpc/accept_voice_consent') {        // FAKED: nothing reaches staging
      state.consentCalls++;
      if (state.consentHold) await state.consentHold.promise;
      state.consent[subOf(req.headers().authorization)] = true;   // recorded for the account that sent it
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (url.pathname === '/voice_explanations' && req.method() === 'POST' && MODE === 'sync') {   // FAKED sync insert
      const body = JSON.parse(req.postData() || '{}');
      const id = crypto.randomUUID();
      state.inserts.push({ id, body, sub: subOf(req.headers().authorization) });
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
      const sub = subOf(req.headers().authorization);
      if (byKey || byPath) {
        state.lookups.push(byKey ? `key:${byKey}` : `path:${byPath}`);
        if (state.lookup === 'hang') return;                   // never answers (route left pending)
        if (state.lookup === 'error') return json(route, 503, { message: 'test outage' });
        const hit = [...state.rows.keys()].map((id) => rowOf(state, id))
          .find((r) => r.student_id === sub && (byKey ? r.transcription_idempotency_key === byKey : r.storage_path === byPath));
        return json(route, 200, hit ? [hit] : []);
      }
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (id && state.hangOnce.has(id)) { state.hangOnce.delete(id); state.hung++; return; }   // this one request never answers
      if (id && state.rows.has(id) && rowOf(state, id).student_id === sub) {                  // RLS: own rows only
        if (state.pollHold) { const answer = await state.pollHold.promise; return json(route, 200, [answer ?? rowOf(state, id)]); }
        return json(route, 200, [rowOf(state, id)]);
      }
      return json(route, 200, []);
    }
    return route.continue();
  });
  await page.route(`${TRANSCRIBER}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    note(req);
    if (state.transcribeHold) await state.transcribeHold.promise;
    return json(route, 200, { text: 'I built a queue, changed polling to a lease token and tested every step twice today.', segments: [] });
  });
  await page.goto(opts.url ?? HARNESS, { waitUntil: 'domcontentloaded' });
  await page.getByRole('dialog').waitFor({ timeout: 30000 });
  return page;
}
const readKey = (page, key) => ev(page, (k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }, key);
const v3Records = (page) => ev(page, () => Object.keys(localStorage).filter((k) => k.startsWith('pl.voiceJob.v3:'))
  .map((k) => ({ key: k, ...JSON.parse(localStorage.getItem(k) || 'null') })).filter((j) => j.idempotencyKey));
async function waitFor(fn, ms = 20000) {
  for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
const H = (page, method, ...args) => ev(page, ({ method, args }) => window.__harness[method](...args), { method, args });
const micState = (page) => ev(page, () => ({ calls: window.__mic.calls, recorders: window.__recorders,
  tracks: window.__mic.streams.flatMap((s) => s.getTracks().map((t) => t.readyState)) }));
/** The newest per-recording record for a context (as persisted). */
const marker = (page, student = A, task = TASK, proof = null) => ev(page, ({ student, task, proof }) => {
  try {
    const all = Object.keys(localStorage).filter((k) => k.startsWith('pl.voiceJob.v3:'))
      .map((k) => JSON.parse(localStorage.getItem(k) || 'null'))
      .filter((j) => j && j.studentId === student && (j.taskId ?? null) === (task ?? null) && (j.proofId ?? null) === (proof ?? null));
    all.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return all[0] ?? null;
  } catch { return 'blocked'; }
}, { student, task, proof });
const startBtn = (page) => page.getByRole('button', { name: /Start recording/ });
const stopBtn = (page) => page.getByRole('button', { name: /Stop and save/ });
async function recordAndStop(page, ms = 2000) {
  await startBtn(page).click({ timeout: 20000 });
  await stopBtn(page).waitFor({ timeout: 20000 });
  await page.waitForTimeout(ms);
  await stopBtn(page).click();
}
const score77 = (page, ms = 20000) => page.getByText(/Communication score 77\/100/).waitFor({ timeout: ms }).then(() => true, () => false);
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
async function group(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try { await fn(); } catch (e) { check(`${name} (unexpected) ${e.message.split('\n')[0].slice(0, 200)}`, false); }
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
});
try {
  if (MODE === 'sync') await syncTests(browser);
  else { await previousTests(browser); await round4Tests(browser); }
} finally {
  await browser.close();
}
console.log(`INFO  writes blocked in the browser: ${JSON.stringify([...new Set(blocked)])}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);

// ======================= previously accepted behaviour (H1-H37) =======================
async function previousTests(browser) {
  await group('H1-H3 microphone', async () => {
    await lateMicCase(browser, 'H1 parent sets open=false', (p) => H(p, 'setOpen', false));
    await lateMicCase(browser, 'H2 account change', (p) => H(p, 'setAccount', B));
    await lateMicCase(browser, 'H3 unmount', (p) => H(p, 'setMounted', false));
  });

  await group('H4-H5 setup failures', async () => {
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
  });

  await group('H6 clock', async () => {
    const { page, state, ctx } = await setup(browser);
    await startBtn(page).click({ timeout: 20000 });
    await stopBtn(page).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    // 61 s pass while the tab's timers were throttled: one late tick must stop it
    await ev(page, () => { window.__timeOffset += 61_000; });
    await waitFor(() => state.enqueue.length > 0, 15000);
    check('H6 real elapsed-time limit: recorder stopped by one late tick after 61 s; length sent capped at 60',
      state.enqueue[0]?.body?.duration_seconds === 60, `duration_seconds=${state.enqueue[0]?.body?.duration_seconds}`);
    await ctx.close();
  });

  await group('H7 double start', async () => {
    const { page, ctx } = await setup(browser);
    await startBtn(page).waitFor({ timeout: 20000 });
    await ev(page, () => window.__holdMic());
    await ev(page, () => { const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.includes('Start recording')); b.click(); b.click(); });
    await page.waitForTimeout(300);
    await ev(page, () => window.__mic.release());
    await stopBtn(page).waitFor({ timeout: 20000 });
    const m = await micState(page);
    check('H7 rapid double Start: one permission request, one recorder', m.calls === 1 && m.recorders === 1, JSON.stringify(m));
    await ctx.close();
  });

  await group('H8-H10 upload lifecycle', async () => {
    const { page, state, ctx } = await setup(browser);
    state.putHold = deferred();
    await recordAndStop(page);
    await page.getByText(/Uploading your recording/).waitFor({ timeout: 20000 });
    await waitFor(() => state.puts.length === 1);            // the upload (and its local copy) has started
    await H(page, 'setOpen', false);                          // parent closes during the upload
    const log1 = await ev(page, () => window.__blobLog);
    const local = log1.created.find((c) => c.type.includes('webm') || c.type.includes('ogg') || c.type.startsWith('audio') || c.type === '')?.url;
    check('H8 close during upload: local blob URL revoked', !!local && log1.revoked.includes(local));
    await H(page, 'setOpen', true);                           // reopen while still uploading
    await page.getByText(/Uploading your recording|still uploading/).first().waitFor({ timeout: 10000 });
    check('H9 reopen during upload: waits, no Start button', (await startBtn(page).count()) === 0);
    state.putHold.resolve();                                  // upload succeeds after the close
    await score77(page, 30000);
    const audio = await page.locator('[role=dialog] audio').evaluateAll((els) => els.map((e) => e.src));
    check('H10 upload success after close: no revoked URL restored; stored-file playback offered; one upload/enqueue',
      !audio.includes(local) && (await page.getByRole('button', { name: /Play recording/ }).count()) === 1 && state.puts.length === 1 && state.enqueue.length === 1,
      `audio=${audio.length} uploads=${state.puts.length} enqueues=${state.enqueue.length}`);
    await ctx.close();
  });

  await group('H11-H13 late polls', async () => {
    const { page, state, ctx } = await setup(browser);
    state.pollHold = deferred();
    await recordAndStop(page);
    await waitFor(() => state.enqueue.find((e) => e.id));
    await page.waitForTimeout(500);
    const idA = state.enqueue.find((e) => e.id).id;
    await H(page, 'setAccount', B);                          // account changes with A's poll in flight
    const hold = state.pollHold; state.pollHold = null;
    hold.resolve(row(idA, { ...state.owner.get(idA), transcription_status: 'failed', transcription_error: 'STALE ANSWER', status: 'recorded', communication_score: null }));
    await page.waitForTimeout(1500);
    const mkA = await marker(page, A);
    const stale = await page.getByText('STALE ANSWER').count();
    check('H11 late poll after account change: ignored, A\'s recovery record kept', mkA?.voiceId === idA && stale === 0);
    check('H12 account change: B is asked for consent (A\'s yes not reused)', await page.getByText('Before you record').isVisible());
    await H(page, 'setAccount', A);
    check('H13 switching back to A resumes A\'s own job (context matched)', await score77(page, 30000));
    await ctx.close();
  });

  await group('H14-H16 lost enqueue answers', async () => {
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
    const b = state.enqueue[0].body;
    state.enqueue.push({ id, body: b });
    state.owner.set(id, { student_id: A, task_id: b.task_id, proof_id: b.proof_id, storage_path: b.storage_path, transcription_idempotency_key: b.idempotency_key });
    state.rows.set(id, row(id));
    const before = state.enqueue.length;
    await page.getByRole('button', { name: /Resume existing recording/ }).click();
    await score77(page, 30000);
    const throws = await ev(page, () => window.__storageThrows);
    check('H16 resume found the existing job by its key: no new enqueue; storage was blocked throughout',
      state.enqueue.length === before && throws > 0, `storage throws=${throws}`);
    await ctx.close();
  });

  await group('H17-H18 scores and PDF', async () => {
    for (const [label, over, expectNumber] of [
      ['H17 scored 77', {}, true],
      ['H18 status failed + stray 85', { status: 'failed', communication_score: 85, communication_notes: 'Too little speech to score.' }, false],
    ]) {
      const { page, state, ctx } = await setup(browser);
      state.autoComplete = false;
      await recordAndStop(page);
      await waitFor(() => state.enqueue.find((e) => e.id));
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
        expectNumber ? (shown === 1 && inPdf) : (shown === 0 && !inPdf), `shown=${shown} pdfHasScore=${inPdf}`);
      await ctx.close();
    }
  });

  await group('H19-H20 other proof', async () => {
    const { page, state, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P1}` });
    state.autoComplete = false;
    await recordAndStop(page);
    await waitFor(() => state.enqueue.find((e) => e.id));
    const j1 = state.enqueue.find((e) => e.id);
    await H(page, 'setProof', P2);
    await startBtn(page).waitFor({ timeout: 15000 });
    const m1 = await marker(page, A, TASK, P1), m2 = await marker(page, A, TASK, P2);
    check('H19 other proof, same task: P2 offers Start (P1\'s job not resumed there); P1 record kept with proof P1',
      m1?.voiceId === j1.id && m1?.proofId === P1 && m2 === null && j1.body.proof_id === P1,
      `P1=${JSON.stringify(m1 && { v: m1.voiceId, p: m1.proofId })} P2=${JSON.stringify(m2)}`);
    state.rows.set(j1.id, row(j1.id));
    await H(page, 'setProof', P1);
    check('H20 back to P1: P1\'s own job resumed', await score77(page));
    await ctx.close();
  });

  await group('H21-H23 concurrent contexts', async () => {
    for (const [label, change, bCtx] of [
      ['proof', (p) => H(p, 'setProof', P2), [A, TASK, P2]],
      ['task', (p) => H(p, 'setTask', 'harness-task-2'), [A, 'harness-task-2', P1]],
    ]) {
      const { page, state, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P1}` });
      state.putHold = deferred();
      state.autoComplete = false;
      await recordAndStop(page);                                   // A's upload is held
      await waitFor(() => state.puts.length === 1);
      await change(page);                                          // move to context B while A uploads
      await recordAndStop(page, 1500);                             // B records and saves too
      const bothUploading = await waitFor(() => state.puts.length === 2, 15000);
      state.putHold.resolve();
      await waitFor(() => state.enqueue.filter((e) => e.id).length === 2, 20000);
      const keys = new Set(state.enqueue.map((e) => e.body.idempotency_key));
      const bodyA = state.enqueue.find((e) => e.body.proof_id === P1 && e.body.task_id === TASK);
      const bodyB = state.enqueue.find((e) => e !== bodyA);
      const mA = await marker(page, A, TASK, P1);
      const mB = await marker(page, ...bCtx);
      for (const e of state.enqueue) if (e.id) state.rows.set(e.id, row(e.id));
      await score77(page);
      check(`H21 ${label} change during A's upload: B could still record and save (2 uploads, 2 enqueues)`,
        bothUploading && state.puts.length === 2 && state.enqueue.length === 2, `puts=${state.puts.length} enqueues=${state.enqueue.length}`);
      check(`H22 ${label}: unique idempotency keys; each enqueue carries its own task/proof`,
        keys.size === 2 && !!bodyA && !!bodyB && bodyB.body.proof_id === bCtx[2] && bodyB.body.task_id === bCtx[1],
        JSON.stringify(state.enqueue.map((e) => [e.body.task_id, e.body.proof_id])));
      check(`H23 ${label}: A keeps its own recovery record (own key/path); B's record is B's`,
        mA?.idempotencyKey === bodyA?.body.idempotency_key && mA?.storagePath === bodyA?.body.storage_path && mA?.voiceId === bodyA?.id &&
        mB?.idempotencyKey === bodyB?.body.idempotency_key && mB?.voiceId === bodyB?.id,
        `A=${mA?.voiceId === bodyA?.id} B=${mB?.voiceId === bodyB?.id}`);
      await ctx.close();
    }
  });

  await group('H24 hung poll', async () => {
    const { page, state, ctx } = await setup(browser);
    state.autoComplete = false;
    await recordAndStop(page);
    await waitFor(() => state.enqueue.find((e) => e.id));
    const id = state.enqueue.find((e) => e.id).id;
    await H(page, 'setOpen', false);
    state.hangOnce.add(id);
    await H(page, 'setOpen', true);
    await waitFor(() => state.hung === 1, 10000);
    state.rows.set(id, row(id));
    await H(page, 'setOpen', false);
    await H(page, 'setOpen', true);
    const ok = await score77(page, 15000);
    check('H24 hung progress check from an older session: new session checks on its own and shows the result', ok && state.hung === 1, `hung=${state.hung}`);
    await ctx.close();
  });

  await group('H25 hung lookup', async () => {
    const k = crypto.randomUUID();
    const seed = { [v2Key(A, TASK, null)]: { voiceId: null, idempotencyKey: k, storagePath: `${A}/seeded-explain.webm`, durationSeconds: 21, studentId: A, taskId: TASK, proofId: null } };
    const { page, state, ctx } = await setup(browser, { seed, lookup: 'hang' });
    await page.getByText(/Uploading your recording/).waitFor({ timeout: 15000 });     // stuck on the hung lookup
    await waitFor(() => state.lookups.length >= 1);
    state.lookup = 'auto';
    await H(page, 'setOpen', false);
    await H(page, 'setOpen', true);
    const ok = await score77(page);
    check('H25 hung resume lookup (previous-build record): next session resumes, retries the SAME key/path/duration once',
      ok && state.enqueue.length === 1 && state.enqueue[0].body.idempotency_key === k && state.enqueue[0].body.storage_path === `${A}/seeded-explain.webm` && state.enqueue[0].body.duration_seconds === 21,
      `enqueues=${state.enqueue.length}`);
    await ctx.close();
  });

  await group('H26-H27 consent', async () => {
    const { page, state, ctx } = await setup(browser, { consent: { [A]: false, [B]: false } });
    await page.getByText('Before you record').waitFor({ timeout: 15000 });
    state.consentHold = deferred();
    await page.getByRole('button', { name: /I understand/ }).click();
    await waitFor(() => state.consentCalls === 1);
    await H(page, 'setAccount', B);                                     // A's acceptance still in flight
    await page.waitForTimeout(500);
    state.consentHold.resolve();                                        // A's answer arrives while B is shown
    await page.waitForTimeout(1000);
    const bAsked = await page.getByText('Before you record').isVisible();
    const bStart = await startBtn(page).count();
    const bSaving = await page.getByRole('button', { name: /Saving…/ }).count();
    const m = await micState(page);
    check('H26 A\'s late "I understand" after switching to B: B still asked, no Start, no microphone',
      bAsked && bStart === 0 && bSaving === 0 && m.calls === 0 && !state.consent[B], `asked=${bAsked} start=${bStart} saving=${bSaving} mic=${m.calls}`);
    await H(page, 'setAccount', A);                                     // A re-reads its own (now given) consent
    check('H27 back to A: A\'s own consent (read from the server) allows Start', await startBtn(page).waitFor({ timeout: 15000 }).then(() => true, () => false));
    await ctx.close();
  });

  const legacySeed = (k, extra = {}) => ({ [legacyKey(A, TASK, P2)]: { voiceId: null, idempotencyKey: k, storagePath: `${A}/1700000000000-explain.webm`, durationSeconds: 20, ...extra } });
  const url2 = `${HARNESS}&proof=${P2}`;
  await group('H28-H33 legacy records', async () => {
    {
      const k = crypto.randomUUID();
      const other = row('legacy-row-p1', { proof_id: P1, transcription_idempotency_key: k, storage_path: `${A}/1700000000000-explain.webm` });
      const { page, state, ctx } = await setup(browser, { url: url2, seed: legacySeed(k), rows: [other] });
      await startBtn(page).waitFor({ timeout: 15000 });
      const kept = await readKey(page, legacyKey(A, TASK, P2));
      check('H28 legacy record whose server row is another proof (same task): not attached, untouched, Start offered',
        kept?.idempotencyKey === k && state.enqueue.length === 0 && (await marker(page, A, TASK, P2)) === null, `lookups=${state.lookups.join(',')}`);
      await ctx.close();
    }
    {
      const k = crypto.randomUUID();
      const { page, state, ctx } = await setup(browser, { url: url2, seed: legacySeed(k) });
      await page.getByTestId('voice-legacy').waitFor({ timeout: 15000 });
      const attach = await page.getByRole('button', { name: /save it here/ }).count();
      const kept = await readKey(page, legacyKey(A, TASK, P2));
      check('H29 legacy record unknown to the server: explicit choice shown; no enqueue; untouched; key AND path checked',
        attach === 1 && state.enqueue.length === 0 && kept?.idempotencyKey === k && state.lookups.some((l) => l.startsWith('key:')) && state.lookups.some((l) => l.startsWith('path:')),
        `lookups=${state.lookups.length}`);
      await page.getByRole('button', { name: /save it here/ }).click();
      const ok = await score77(page);
      check('H30 "save it here" (explicit): one enqueue with the SAME key/path/duration and THIS proof; old key retired',
        ok && state.enqueue.length === 1 && state.enqueue[0].body.idempotency_key === k && state.enqueue[0].body.proof_id === P2 && state.enqueue[0].body.duration_seconds === 20 &&
        (await readKey(page, legacyKey(A, TASK, P2))) === null, `enqueues=${state.enqueue.length}`);
      await ctx.close();
    }
    {
      const k = crypto.randomUUID();
      const { page, state, ctx } = await setup(browser, { url: url2, seed: legacySeed(k), lookup: 'error' });
      await page.getByTestId('voice-legacy').waitFor({ timeout: 15000 });
      const attach = await page.getByRole('button', { name: /save it here/ }).count();
      check('H31 legacy record, server check fails: no attach offered, no enqueue, untouched',
        attach === 0 && state.enqueue.length === 0 && (await readKey(page, legacyKey(A, TASK, P2)))?.idempotencyKey === k);
      await page.getByRole('button', { name: /Keep it aside/ }).click();
      await startBtn(page).waitFor({ timeout: 10000 });
      const aside = await readKey(page, v3Key(k));
      const listed = await page.getByTestId('voice-aside-item').count();
      check('H32 "keep it aside": kept as a per-recording record marked aside, listed under Start, not deleted',
        aside?.idempotencyKey === k && aside?.aside === true && listed === 1 && (await readKey(page, legacyKey(A, TASK, P2))) === null && state.enqueue.length === 0);
      await ctx.close();
    }
    {
      const k = crypto.randomUUID();
      const mine = row('legacy-row-p2', { proof_id: P2, transcription_idempotency_key: k, storage_path: `${A}/1700000000000-explain.webm` });
      const { page, state, ctx } = await setup(browser, { url: url2, seed: legacySeed(k), rows: [mine] });
      const ok = await score77(page);
      check('H33 legacy record proven this proof\'s by the server: resumed without any new enqueue; old key retired',
        ok && state.enqueue.length === 0 && (await readKey(page, legacyKey(A, TASK, P2))) === null);
      await ctx.close();
    }
  });

  await group('H34-H35 write-blocked storage', async () => {
    const oldK = crypto.randomUUID();
    const seed = { [v2Key(A, TASK, null)]: { voiceId: null, idempotencyKey: oldK, storagePath: `${A}/old-explain.webm`, durationSeconds: 30, studentId: A, taskId: TASK, proofId: null } };
    // two lost answers: the first attempt and its one automatic retry
    const { page, state, ctx } = await setup(browser, { seed, writeBlockVoiceStorage: true, lookup: 'error', enqueueLost: 2 });
    await page.getByTestId('voice-uncertain').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: /Keep it aside/ }).click();
    await H(page, 'setOpen', false);
    await H(page, 'setOpen', true);
    await startBtn(page).waitFor({ timeout: 15000 });
    const persisted = await readKey(page, v2Key(A, TASK, null));
    const oldAttempts = state.enqueue.length;
    check('H34 writes blocked: the kept-aside job does not come back on reopen, and its persisted copy is NOT deleted',
      persisted?.idempotencyKey === oldK && (await page.getByTestId('voice-uncertain').count()) === 0, `persisted=${!!persisted}`);
    state.lookup = 'auto'; state.enqueueLost = 1;                // new recording: answer lost once, write blocked
    await recordAndStop(page);
    await score77(page, 30000);
    const newer = state.enqueue.slice(oldAttempts);
    check('H35 writes blocked: the newer recording\'s in-memory record wins (retry used the NEW key only)',
      newer.length === 2 && newer.every((e) => e.body.idempotency_key !== oldK && e.body.idempotency_key === newer[0].body.idempotency_key),
      `attempts=${newer.length} throws=${await ev(page, () => window.__storageThrows)}`);
    await ctx.close();
  });

  await group('H36-H37 length', async () => {
    {
      const { page, state, ctx } = await setup(browser);
      await startBtn(page).click({ timeout: 20000 });
      await stopBtn(page).waitFor({ timeout: 20000 });
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
      const recs = await v3Records(page);
      check('H37 SIMULATED 75 s of decoded audio: refused - nothing uploaded, nothing enqueued, no record left',
        state.puts.length === 0 && state.enqueue.length === 0 && recs.length === 0);
      await ctx.close();
    }
  });
}

// ======================= round-3 audit findings (F1-F9) =======================
async function round4Tests(browser) {
  // F1: writes fail but removal works - a record being moved must survive a reload.
  await group('F1 durable move', async () => {
    const k = crypto.randomUUID();
    const seed = { [v2Key(A, TASK, null)]: { voiceId: null, idempotencyKey: k, storagePath: `${A}/f1-explain.webm`, durationSeconds: 12, studentId: A, taskId: TASK, proofId: null } };
    const { page, state, ctx } = await setup(browser, { seed, setBlockVoiceStorage: true, lookup: 'error', enqueueLost: 5 });
    await page.getByTestId('voice-uncertain').waitFor({ timeout: 20000 });
    const kept1 = await readKey(page, v2Key(A, TASK, null));
    await page.reload({ waitUntil: 'domcontentloaded' });            // full reload: memory is gone
    await page.getByTestId('voice-uncertain').waitFor({ timeout: 20000 });
    const kept2 = await readKey(page, v2Key(A, TASK, null));
    const keys = new Set(state.enqueue.map((e) => e.body.idempotency_key));
    check('F1a writes fail, removal works: the original record is NOT deleted when its move cannot be stored; after a reload it is resumed with the same key',
      kept1?.idempotencyKey === k && kept2?.idempotencyKey === k && keys.size === 1 && keys.has(k), `enqueue attempts=${state.enqueue.length}`);
    await ctx.close();
  });
  await group('F1 durable aside', async () => {
    const k = crypto.randomUUID();
    const seed = { [legacyKey(A, TASK, P2)]: { voiceId: null, idempotencyKey: k, storagePath: `${A}/1700000000001-explain.webm`, durationSeconds: 20 } };
    const { page, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P2}`, seed, setBlockVoiceStorage: true, lookup: 'error' });
    await page.getByTestId('voice-legacy').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Keep it aside/ }).click();
    await startBtn(page).waitFor({ timeout: 10000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('voice-legacy').waitFor({ timeout: 20000 }).catch(() => {});
    const kept = await readKey(page, legacyKey(A, TASK, P2));
    check('F1b "keep aside" with writes failing: the original record survives a reload (it is offered again, not lost)',
      kept?.idempotencyKey === k && (await page.getByTestId('voice-legacy').count()) === 1,
      `kept=${!!kept} legacyShown=${await page.getByTestId('voice-legacy').count()} text=${(await page.getByRole('dialog').innerText()).slice(60, 200).replace(/\s+/g, ' ')}`);
    await ctx.close();
  });

  // F2: two tabs, same student/task/proof, one browser storage.
  await group('F2 two tabs', async () => {
    const frozenNow = Date.now();   // both tabs' clocks stopped at the same millisecond (a real instant: tokens stay valid)
    const { page: tab1, state, ctx } = await setup(browser, { frozenNow });
    const tab2 = await addPage(ctx, state);
    state.putHold = deferred();
    state.autoComplete = false;
    // only the visible tab can record (a hidden tab stops recording at once), so each is brought to the front
    await tab1.bringToFront();
    await recordAndStop(tab1, 1500);
    await waitFor(() => state.puts.length === 1);
    await tab2.bringToFront();
    await recordAndStop(tab2, 1500);
    await waitFor(() => state.puts.length === 2, 20000);
    const during = await v3Records(tab1);
    state.putHold.resolve();
    await waitFor(() => state.enqueue.filter((e) => e.id).length === 2, 20000);
    const paths = new Set(state.enqueue.map((e) => e.body.storage_path));
    const keys = new Set(state.enqueue.map((e) => e.body.idempotency_key));
    check('F2a two tabs saving the same work at once: two separate records (neither overwritten), both stored and enqueued',
      during.length === 2 && new Set(during.map((r) => r.idempotencyKey)).size === 2 && state.enqueue.length === 2 && keys.size === 2,
      `records during upload=${during.length} enqueues=${state.enqueue.length}`);
    check('F7 frozen clock in both tabs: two different storage paths, no 409 collision',
      paths.size === 2 && [...paths].every((p) => /^[0-9a-f-]{36}\/[0-9a-f-]{36}-explain\.webm$/.test(p)), [...paths].map((p) => p.split('/')[1].slice(0, 8)).join(','));
    await ctx.close();
  });
  await group('F2 live other tab', async () => {
    const { page: tab1, state, ctx } = await setup(browser);
    state.putHold = deferred();
    await recordAndStop(tab1, 1500);
    await waitFor(() => state.puts.length === 1);
    const tab2 = await addPage(ctx, state);
    await startBtn(tab2).waitFor({ timeout: 15000 });
    const notice = await tab2.getByTestId('voice-other-tab').count();
    await tab2.waitForTimeout(1000);
    check('F2b a recording another OPEN tab is still sending is left alone (no existence check, no enqueue) and the student is told',
      notice === 1 && state.gets.length === 0 && state.enqueue.length === 0, `gets=${state.gets.length}`);
    state.putHold.resolve();
    check('F2b the sending tab finishes its own recording', await score77(tab1));
    await ctx.close();
  });
  await group('F2 holder closed', async () => {
    const { page: tab1, state, ctx } = await setup(browser);
    state.putMode = 'hang';                                           // the upload never answers
    await recordAndStop(tab1, 1500);
    await waitFor(() => state.puts.length === 1);
    await tab1.close({ runBeforeUnload: false });                     // the tab holding it is closed
    const tab2 = await addPage(ctx, state);
    await tab2.getByTestId('voice-interrupted').waitFor({ timeout: 20000 });
    check('F2c tab holding an unfinished upload is closed: another tab checks the server, finds no file, and says plainly it was NOT saved',
      state.gets.length === 1 && state.enqueue.length === 0, `gets=${state.gets.length}`);
    await tab2.getByRole('button', { name: /Record it again/ }).click();
    check('F2c acknowledging it clears the record and offers Start', await startBtn(tab2).waitFor({ timeout: 10000 }).then(() => true, () => false) && (await v3Records(tab2)).length === 0);
    await ctx.close();
  });
  await group('F2 holder crashed', async () => {
    const { page: tab1, state, ctx } = await setup(browser);
    state.putMode = 'store-then-abort';                               // the file IS stored, the answer is lost
    state.putHold = deferred();
    await recordAndStop(tab1, 1500);
    await waitFor(() => state.puts.length === 1);
    // SIMULATED crash: the holder stops without pagehide; another tab whose clock is 20 s ahead sees a stale heartbeat
    const tab2 = await addPage(ctx, state, {});
    await ev(tab2, () => { window.__timeOffset = 20_000; });
    state.putHold.resolve();
    await tab1.waitForTimeout(500);
    await ev(tab1, () => { window.__harness.setMounted(false); });
    await H(tab2, 'setOpen', false);
    await H(tab2, 'setOpen', true);
    const ok = await score77(tab2, 25000);
    check('F2d SIMULATED crashed holder (stale heartbeat): another tab finds the stored file and completes the SAME recording once',
      ok && state.enqueue.filter((e) => e.id).length === 1, `enqueues=${state.enqueue.length} gets=${state.gets.length}`);
    await ctx.close();
  });

  // F3: a delayed event from an old recorder must not touch the new one.
  await group('F3 delayed recorder events', async () => {
    const { page, state, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P1}`, holdRecorders: [1] });
    await recordAndStop(page, 3500);                                  // A: 3.5 s; its data/stop events are held
    await H(page, 'setProof', P2);                                    // context change ends A's session
    await startBtn(page).click({ timeout: 20000 });                   // B starts
    await stopBtn(page).waitFor({ timeout: 20000 });
    await page.waitForTimeout(700);
    await ev(page, () => window.__releaseRecorder(1));                // A's late events arrive now
    await page.waitForTimeout(800);
    const bRecording = await stopBtn(page).isVisible();
    const tracks = await ev(page, () => window.__mic.streams.map((s) => s.getTracks().map((t) => t.readyState)[0]));
    await stopBtn(page).click();
    await waitFor(() => state.enqueue.filter((e) => e.id).length === 2, 20000);
    const byProof = Object.fromEntries(state.enqueue.map((e) => [e.body.proof_id, state.puts.find((p) => p.path === e.body.storage_path)?.size ?? 0]));
    check('F3a A\'s late stop did not stop B: B\'s microphone still live and B still recording',
      bRecording && tracks[0] === 'ended' && tracks[1] === 'live', JSON.stringify(tracks));
    check('F3b each recording uploaded only its own audio (A 3.5 s > B 1.5 s), once each, to its own proof',
      byProof[P1] > 0 && byProof[P2] > 0 && byProof[P1] > byProof[P2] && state.puts.length === 2, JSON.stringify(byProof));
    await ctx.close();
  });
  await group('F3 delayed events after unmount', async () => {
    const { page, state, ctx } = await setup(browser, { holdRecorders: [1] });
    await recordAndStop(page, 2000);
    await H(page, 'setMounted', false);
    await H(page, 'setMounted', true);                               // a new dialog instance, same work
    await page.getByText(/Uploading your recording|still uploading/).first().waitFor({ timeout: 10000 });
    await ev(page, () => window.__releaseRecorder(1));
    const ok = await score77(page, 25000);
    check('F3c late events after unmount: the old recording is saved once and the new instance shows it',
      ok && state.puts.length === 1 && state.enqueue.filter((e) => e.id).length === 1, `puts=${state.puts.length} enqueues=${state.enqueue.length}`);
    await ctx.close();
  });

  // F4: the real in-page session changes while A's recording is being sent.
  await group('F4 account change mid-save', async () => {
    const { page, state, ctx } = await setup(browser, { consent: { [B]: true } });
    state.putHold = deferred();
    await recordAndStop(page, 1500);
    await waitFor(() => state.puts.length === 1);
    const aPath = state.puts[0].path;
    await H(page, 'setAccount', B);                                   // credentials AND student switch to B
    state.putHold.resolve();                                          // A's upload finishes while B is signed in
    await page.waitForTimeout(2500);
    const asB = state.requests.filter((r) => r.sub === B && ((r.url ?? '').includes(aPath) || (r.body ?? '').includes(aPath)));
    const rec = await marker(page, A);
    check('F4a nothing for A\'s recording is sent with B\'s session (no enqueue, no lookup, no upload as B)',
      asB.length === 0 && state.enqueue.length === 0 && state.puts[0].sub === A, `requests as B about A's audio=${asB.length}`);
    check('F4b A\'s recovery record is kept (stage uploaded) for A', rec?.stage === 'uploaded' && rec?.storagePath === aPath);
    await H(page, 'setAccount', A);
    const ok = await score77(page, 25000);
    check('F4c back as A: A\'s recording is enqueued with A\'s own session and completes',
      ok && state.enqueue.length === 1 && state.enqueue[0].sub === A && state.enqueue[0].body.storage_path === aPath);
    await ctx.close();
  });
  await group('F4 session mismatch at start', async () => {
    const { page, ctx } = await setup(browser, { consent: { [B]: true } });
    await startBtn(page).waitFor({ timeout: 15000 });
    await H(page, 'setAuth', B);                                      // signed in as B, page still shows A
    await startBtn(page).click();
    await page.getByText(/signed in as a different account/).waitFor({ timeout: 10000 });
    const m = await micState(page);
    check('F4d signed-in account differs from the page\'s student: recording refused before the microphone opens', m.calls === 0);
    await ctx.close();
  });

  // F5: uploads with no answer, lost answers, refusals and reloads.
  await group('F5 no answer', async () => {
    const { page, state, ctx } = await setup(browser);
    state.putMode = 'abort';                                          // network failure: no answer, nothing stored
    await recordAndStop(page, 1500);
    await page.getByTestId('voice-uncertain').waitFor({ timeout: 20000 });
    const text = await page.getByTestId('voice-uncertain').innerText();
    check('F5a upload with no answer: "couldn\'t confirm" - never "nothing reached the server"; audio kept on the page',
      /couldn't confirm the upload finished/i.test(text) && !/nothing reached|not uploaded/i.test(text) && state.enqueue.length === 0);
    await page.getByRole('button', { name: /Resume existing recording/ }).click();
    const ok = await score77(page, 25000);
    check('F5b resume re-sends the SAME audio to the SAME path, then enqueues once',
      ok && state.puts.length === 2 && state.puts[0].path === state.puts[1].path && state.enqueue.length === 1);
    await ctx.close();
  });
  await group('F5 answer lost', async () => {
    const { page, state, ctx } = await setup(browser);
    state.putMode = 'store-then-abort';                               // stored, but the answer is lost
    await recordAndStop(page, 1500);
    await page.getByTestId('voice-uncertain').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: /Resume existing recording/ }).click();
    const ok = await score77(page, 25000);
    check('F5c stored-but-answer-lost: resume gets "already exists" (409) and treats it as stored - one job, no duplicate object',
      ok && state.puts.length === 2 && state.uploaded.size === 1 && state.enqueue.length === 1);
    await ctx.close();
  });
  await group('F5 refused', async () => {
    const { page, state, ctx } = await setup(browser);
    state.putMode = 'refuse';
    await recordAndStop(page, 1500);
    await page.getByText(/was not saved \(That file is too large\)/).waitFor({ timeout: 20000 });
    check('F5d server refuses the upload: says it was not saved (with the reason); no record left, no enqueue',
      (await v3Records(page)).length === 0 && state.enqueue.length === 0);
    await ctx.close();
  });
  await group('F5 reload mid-upload', async () => {
    for (const [label, mode, stored] of [['not stored', 'hang', false], ['already stored', 'store-then-abort', true]]) {
      const { page, state, ctx } = await setup(browser);
      state.putMode = mode;
      if (stored) state.putHold = deferred();
      await recordAndStop(page, 1500);
      await waitFor(() => state.puts.length === 1);
      if (stored) { state.putHold.resolve(); await page.waitForTimeout(300); }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('dialog').waitFor({ timeout: 20000 });
      if (!stored) {
        await page.getByTestId('voice-interrupted').waitFor({ timeout: 20000 });
        check(`F5e reload during an upload (${label}): the server is checked and the student is told it was NOT saved`, state.gets.length === 1 && state.enqueue.length === 0);
      } else {
        const ok = await score77(page, 25000);
        check(`F5f reload during an upload (${label}): the server is checked, the file is found, the SAME recording is enqueued once`, ok && state.enqueue.length === 1);
      }
      await ctx.close();
    }
  });

  // F6: kept-aside recordings can be found, checked, saved or removed - and survive a reload.
  await group('F6 aside round trip', async () => {
    const { page, state, ctx } = await setup(browser, { lookup: 'error', enqueueLost: 2, consent: { [B]: true } });
    await recordAndStop(page, 1500);
    await page.getByTestId('voice-uncertain').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: /Keep it aside/ }).click();
    await page.getByTestId('voice-aside-item').waitFor({ timeout: 10000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('voice-aside-item').waitFor({ timeout: 20000 });
    check('F6a a kept-aside recording is listed under Start and survives a reload', (await page.getByTestId('voice-aside-item').count()) === 1);
    await H(page, 'setAccount', B);
    await startBtn(page).waitFor({ timeout: 15000 });
    check('F6b another account never sees it', (await page.getByTestId('voice-aside-list').count()) === 0);
    await H(page, 'setAccount', A);
    await page.getByTestId('voice-aside-item').waitFor({ timeout: 15000 });
    state.lookup = 'auto';
    await page.getByRole('button', { name: /^Check$/ }).click();
    await page.getByText(/You can save it to this work/).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Save it to this work/ }).click();
    const ok = await score77(page, 25000);
    check('F6c "Check" finds it was never processed (file present, no job); "Save it to this work" completes it with its own key',
      ok && state.enqueue.filter((e) => e.id).length === 1 && new Set(state.enqueue.map((e) => e.body.idempotency_key)).size === 1);
    await ctx.close();
  });
  await group('F6 aside remove', async () => {
    const { page, state, ctx } = await setup(browser, { lookup: 'error', enqueueLost: 2 });
    await recordAndStop(page, 1500);
    await page.getByTestId('voice-uncertain').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: /Keep it aside/ }).click();
    await page.getByRole('button', { name: /Remove from this list/ }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await startBtn(page).waitFor({ timeout: 20000 });
    check('F6d "Remove from this list" is explicit and permanent on this device (gone after reload; no server call)',
      (await page.getByTestId('voice-aside-list').count()) === 0 && (await v3Records(page)).length === 0 && state.enqueue.length === 2);
    await ctx.close();
  });

  // F8: a stale or edited local record is never shown for work whose server row disagrees.
  await group('F8 tampered record', async () => {
    const k = crypto.randomUUID();
    const rowP1 = row('row-of-p1', { proof_id: P1, storage_path: `${A}/p1-explain.webm`, transcription_idempotency_key: 'k-p1' });
    const seed = { [v3Key('forged')]: { voiceId: 'row-of-p1', idempotencyKey: k, storagePath: `${A}/p2-explain.webm`, durationSeconds: 9,
      studentId: A, taskId: TASK, proofId: P2, recordingId: 'forged', stage: 'uploaded', createdAt: 1 } };
    const { page, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P2}`, seed, rows: [rowP1] });
    await page.getByTestId('voice-legacy').waitFor({ timeout: 20000 });
    check('F8a a record pointing at another proof\'s row: nothing shown here (no score), student asked; record not deleted',
      (await page.getByText(/Communication score/).count()) === 0 && !!(await readKey(page, v3Key('forged'))));
    await ctx.close();
  });

  // F9: hide vs navigate vs close - truthful about what was saved.
  await group('F9 navigate', async () => {
    const { page, state, ctx } = await setup(browser);
    await startBtn(page).click({ timeout: 20000 });
    await stopBtn(page).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.goto('about:blank');                                   // leave mid-recording (warning accepted)
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('voice-interrupted').waitFor({ timeout: 20000 });
    check('F9a navigating away mid-recording: the browser warned first; next visit says plainly it was NOT saved (no upload claimed)',
      (state.dialogs ?? []).includes('beforeunload') && state.enqueue.length === 0, `dialogs=${JSON.stringify(state.dialogs)} puts=${state.puts.length}`);
    await ctx.close();
  });
  await group('F9 close', async () => {
    const { page, state, ctx } = await setup(browser);
    await startBtn(page).click({ timeout: 20000 });
    await stopBtn(page).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.close({ runBeforeUnload: true });
    await waitFor(() => page.isClosed(), 10000);
    const tab2 = await addPage(ctx, state);
    await tab2.getByTestId('voice-interrupted').waitFor({ timeout: 20000 });
    check('F9b closing the tab mid-recording: warned first; the next tab says it was NOT saved',
      (state.dialogs ?? []).includes('beforeunload') && state.enqueue.length === 0);
    await ctx.close();
  });
}

// ======================= synchronous (legacy) save path =======================
async function syncTests(browser) {
  await group('S1-S3 concurrent', async () => {
    const { page, state, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P1}` });
    state.putHold = deferred();
    await recordAndStop(page);
    await waitFor(() => state.puts.length === 1);
    await H(page, 'setProof', P2);
    await recordAndStop(page, 1500);
    const both = await waitFor(() => state.puts.length === 2, 20000);
    state.putHold.resolve();
    await page.getByText(/Communication score 70\/100/).waitFor({ timeout: 30000 });
    await waitFor(() => state.inserts.length === 2, 10000);
    await page.waitForTimeout(1500);
    const proofs = state.inserts.map((i) => i.body.proof_id).sort();
    check('S1 sync path: A\'s save in flight did not swallow B\'s (2 uploads, 2 inserts)', both && state.puts.length === 2 && state.inserts.length === 2,
      `puts=${state.puts.length} inserts=${state.inserts.length}`);
    check('S2 sync path: each insert carries its own proof (P1, P2), same task and student',
      JSON.stringify(proofs) === JSON.stringify([P1, P2]) && state.inserts.every((i) => i.body.task_id === TASK && i.body.student_id === A));
    check('S3 sync path: B\'s screen shows B\'s saved result', await page.getByText(/Saved\. It will appear/).isVisible());
    check('S4 sync path (F7): paths are <student>/<random id>-explain.webm, distinct',
      new Set(state.puts.map((p) => p.path)).size === 2 && state.puts.every((p) => /^[0-9a-f-]{36}\/[0-9a-f-]{36}-explain\.webm$/.test(p.path)));
    await ctx.close();
  });
  await group('S5 delayed recorder events', async () => {
    const { page, state, ctx } = await setup(browser, { url: `${HARNESS}&proof=${P1}`, holdRecorders: [1] });
    await recordAndStop(page, 3500);
    await H(page, 'setProof', P2);
    await startBtn(page).click({ timeout: 20000 });
    await stopBtn(page).waitFor({ timeout: 20000 });
    await page.waitForTimeout(700);
    await ev(page, () => window.__releaseRecorder(1));
    await page.waitForTimeout(800);
    const bRecording = await stopBtn(page).isVisible();
    await stopBtn(page).click();
    await waitFor(() => state.inserts.length === 2, 25000);
    const size = (proof) => state.puts.find((p) => p.path === state.inserts.find((i) => i.body.proof_id === proof)?.body.storage_path)?.size ?? 0;
    check('S5 sync path (F3): A\'s late events did not stop B; each upload holds only its own audio',
      bRecording && size(P1) > size(P2) && size(P2) > 0 && state.inserts.length === 2, `A=${size(P1)} B=${size(P2)}`);
    await ctx.close();
  });
  await group('S6 account change mid-transcription', async () => {
    const { page, state, ctx } = await setup(browser, { consent: { [B]: true } });
    state.transcribeHold = deferred();
    await recordAndStop(page, 1500);
    await waitFor(() => state.requests.some((r) => r.url.startsWith(TRANSCRIBER) && r.method === 'POST'));
    await H(page, 'setAccount', B);
    state.transcribeHold.resolve();
    await page.waitForTimeout(2500);
    check('S6 sync path (F4): after the account changes to B, A\'s audio is neither uploaded nor inserted with B\'s session',
      state.puts.length === 0 && state.inserts.length === 0, `puts=${state.puts.length} inserts=${state.inserts.length}`);
    await ctx.close();
  });
}
