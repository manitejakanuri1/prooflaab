// Step 6: deterministic browser tests of VoiceExplainModal driven through the
// TEST-ONLY harness (scripts/dev-tools/harness/voice-modal-harness.html), which
// lets the test change props the real pages cannot: parent open=false,
// account change, unmount.
//
// Nothing reaches staging except read-only GETs: uploads, enqueue, progress
// checks and consent answers are faked in the browser; every other write
// (function, RPC, insert/update/delete) is blocked and reported.
//
// Needs `npx vite --mode staging --port 5173 --strictPort` running, and:
//   STAGING_JWT="$(gcloud secrets versions access latest --secret=prooflab-staging-jwt-secret)" \
//     node scripts/dev-tools/voice_modal_harness_browser.mjs <speech.wav>
// Genuine Google sign-in is NOT exercised (session minted like the staging auth-bridge).
import { chromium } from 'playwright';
import crypto from 'node:crypto';

const WAV = process.argv[2];
const APP = 'http://localhost:5173';
const API = 'https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app';
const FN = 'https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app';
const FILES = 'https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app/file/voice-explanations';
const A = '7d71bff4-1ec2-4778-b26d-9567a416bfac';     // t07 (the signed-in session)
const B = '67c7f711-6ca8-4b4d-a586-278857dcb0ab';     // t16 (the "other account")
const TASK = 'harness-task';
const HARNESS = `${APP}/scripts/dev-tools/harness/voice-modal-harness.html?student=${A}&task=${TASK}`;

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
  communication_notes: 'Clear and specific.', storage_path: `${A}/fake-${id}.webm`, ...over,
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

  const state = { putHold: null, puts: 0, enqueue: [], enqueueLost: 0, pollHold: null, rows: new Map(), autoComplete: true,
                  lookup: 'none', consent: { [A]: true, [B]: false } };
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
      state.rows.set(id, row(id, { transcription_status: 'processing', status: 'recorded', communication_score: null }));
      if (state.autoComplete) setTimeout(() => { if (state.autoComplete) state.rows.set(id, row(id)); }, 1500);
      return json(route, 200, { voice_id: id, status: 'pending' });
    }
    if (name === 'client-log') return route.fulfill({ status: 204, headers: CORS });
    blocked.push(`function ${name}`);
    return route.abort('blockedbyclient');
  });
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.continue();
    if (url.pathname.startsWith('/rpc/') || (req.method() !== 'GET' && req.method() !== 'HEAD')) {
      blocked.push(`${req.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/student_profiles' && url.search.includes('voice_consent_at')) {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      return json(route, 200, [{ voice_consent_at: state.consent[id] ? '2026-09-01T00:00:00Z' : null }]);
    }
    if (url.pathname === '/voice_explanations') {
      if (url.searchParams.get('transcription_idempotency_key')) {
        if (state.lookup === 'error') return json(route, 503, { message: 'test outage' });
        if (state.lookup === 'found') { const e = state.enqueue.find((x) => x.id); return json(route, 200, e ? [{ id: e.id }] : []); }
        return json(route, 200, []);
      }
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (id && state.rows.has(id)) {
        if (state.pollHold) { const answer = await state.pollHold.promise; return json(route, 200, [answer ?? state.rows.get(id)]); }
        return json(route, 200, [state.rows.get(id)]);
      }
      return json(route, 200, []);
    }
    return route.continue();
  });
  await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
  await page.getByRole('dialog').waitFor({ timeout: 30000 });
  return { page, state, ctx };
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
const H = (page, method, ...args) => ev(page, ({ method, args }) => window.__harness[method](...args), { method, args });
const micState = (page) => ev(page, () => ({ calls: window.__mic.calls, recorders: window.__recorders,
  tracks: window.__mic.streams.flatMap((s) => s.getTracks().map((t) => t.readyState)) }));
const marker = (page, student = A) => ev(page, (k) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return 'blocked'; }
}, `pl.voiceJob.${student}.${TASK}`);
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
    state.lookup = 'found';
    state.enqueueLost = 0;
    // the server had in fact created the job on the first call:
    const id = crypto.randomUUID();
    state.enqueue.push({ id, body: state.enqueue[0].body });
    state.rows.set(id, row(id));
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
} catch (e) {
  check(`(unexpected) ${e.message.slice(0, 240)}`, false);
} finally {
  await browser.close();
}
console.log(`INFO  writes blocked in the browser: ${JSON.stringify([...new Set(blocked)])}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
