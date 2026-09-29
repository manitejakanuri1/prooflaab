// Step 6: real-browser STAGING check of recording playback after a refresh,
// the Play button's failure handling, and cross-student audio isolation.
//
// Needs `npx vite --mode staging --port 5173 --strictPort` running, and:
//   STAGING_JWT="$(gcloud secrets versions access latest --secret=prooflab-staging-jwt-secret)" \
//     node scripts/dev-tools/voice_playback_browser.mjs <speech.wav>
// Tokens are minted in memory (like the staging auth-bridge issues them) and
// never printed. Makes one real staging recording and one DeepSeek call.
import { chromium } from 'playwright';
import crypto from 'node:crypto';

const WAV = process.argv[2];
const APP = 'http://localhost:5173';
const API = 'https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app';
const FILES = 'https://prooflab-staging-files-ysn2mpe6sa-el.a.run.app/file/voice-explanations';
const T07 = '7d71bff4-1ec2-4778-b26d-9567a416bfac';
const T16 = '67c7f711-6ca8-4b4d-a586-278857dcb0ab';

const b64 = (b) => Buffer.from(b).toString('base64url');
function mint(claims, ttl = 7200) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ ...claims, iat: now, exp: now + ttl }));
  return `${h}.${p}.${crypto.createHmac('sha256', process.env.STAGING_JWT).update(`${h}.${p}`).digest('base64url')}`;
}
const studentToken = (id, email) => mint({ role: 'authenticated', sub: id, email });
const SVC = mint({ role: 'service_role', sub: 'voice-playback-test' }, 3600);
const session = (id, email) => {
  const token = studentToken(id, email);
  return {
    access_token: token, provider_token: token, refresh_token: 'browser-test-no-refresh',
    expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, token_type: 'bearer',
    user: { id, email, aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(),
            last_sign_in_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, identities: [] },
  };
};

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
});
const ctx = await browser.newContext({ permissions: ['microphone'] });
await ctx.addInitScript((s) => { if (!localStorage.getItem('prooflab.auth.google')) localStorage.setItem('prooflab.auth.google', JSON.stringify(s)); },
  session(T07, 'vidyuthsetu+t07@gmail.com'));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  pageerror: ${e.message.slice(0, 160)}`));

const audioState = (loc) => loc.evaluate((a) => new Promise((res) => {
  const done = () => res({ scheme: a.src.split(':')[0], ready: a.readyState });
  if (a.readyState >= 1) done(); else { a.onloadedmetadata = done; a.onerror = () => res({ scheme: a.src.split(':')[0], ready: -1 }); setTimeout(done, 15000); }
}));
const blockFiles = () => page.route(`${FILES}/**`, (r) => r.abort('failed'));
const unblockFiles = () => page.unroute(`${FILES}/**`);

let job = null;
try {
  // 1. Save a recording, refresh mid-job, finish it.
  await page.goto(`${APP}/student/tasks/assigned`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Explain 60s/ }).first().click({ timeout: 60000 });
  await page.getByRole('button', { name: /Start recording/ }).click({ timeout: 20000 });
  await page.waitForTimeout(14000);
  await page.getByRole('button', { name: /Stop and save/ }).click();
  await page.getByText(/Queued|Writing down what you said/).first().waitFor({ timeout: 60000 });
  job = await page.evaluate((id) => {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(`pl.voiceJob.${id}.`)) return JSON.parse(localStorage.getItem(k)); }
    return null;
  }, T07);
  check('1 recording saved and queued', !!job?.voiceId, `voice ${job?.voiceId?.slice(0, 8)}`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Explain 60s/ }).first().click({ timeout: 60000 });
  await page.getByText('Saved. It will appear in your build-log.').waitFor({ timeout: 150000 });

  // 2. Modal Play (RecordingPlayback) with the download failing: never stuck.
  await blockFiles();
  const modalPlay = page.getByRole('dialog').getByRole('button', { name: /Play recording|Could not load/ });
  await modalPlay.click();
  await page.getByRole('dialog').getByRole('button', { name: /Could not load - try again/ }).waitFor({ timeout: 15000 });
  check('2a failed download: button shows "Could not load - try again" and is not stuck', await page.getByRole('dialog').getByRole('button', { name: /Could not load/ }).isEnabled());
  await unblockFiles();
  await page.getByRole('dialog').getByRole('button', { name: /Could not load - try again/ }).click();
  const a1 = await audioState(page.getByRole('dialog').locator('audio').first());
  check('2b retry after the failure plays the audio', a1.scheme === 'blob' && a1.ready >= 1, JSON.stringify(a1));

  await page.getByText(/Communication score \d+\/100/).waitFor({ timeout: 150000 });
  await page.getByRole('dialog').getByRole('button', { name: /^Done$/ }).click();

  // 3. Refresh, find the completed recording in Build-Log, play it.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(`${APP}/student/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Build-Log/ }).first().click({ timeout: 60000 });
  // The title also holds the count badge, so match the words, not the whole text.
  await page.getByText(/Spoken Explanations/).first().waitFor({ timeout: 60000 });
  const card = page.locator('main, body').first();
  const db = (await (await fetch(`${API}/voice_explanations?id=eq.${job.voiceId}&select=transcript,status,communication_score`,
    { headers: { Authorization: `Bearer ${SVC}` } })).json())[0];
  const entry = card.getByRole('button', { name: new RegExp(db.transcript.slice(0, 25).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  check('3a completed recording found in Build-Log after refresh', await entry.isVisible(), `status=${db.status} score=${db.communication_score}`);
  await entry.click();
  const detail = page.getByRole('dialog');
  await blockFiles();
  await detail.getByRole('button', { name: /Play recording/ }).click();
  await detail.getByRole('button', { name: /Could not load - try again/ }).waitFor({ timeout: 15000 });
  check('3b Build-Log Play with a failed download shows an error, button not stuck',
    await detail.getByRole('button', { name: /Could not load - try again/ }).isEnabled());
  await unblockFiles();
  await detail.getByRole('button', { name: /Could not load - try again/ }).click();
  const a2 = await audioState(detail.locator('audio').first());
  check('3c Build-Log plays the completed recording after refresh', a2.scheme === 'blob' && a2.ready >= 1, JSON.stringify(a2));

  // 4. A second student cannot download the first student's audio (from the browser origin).
  const cross = await page.evaluate(async ({ url, t16, t07 }) => {
    const other = await fetch(url, { headers: { Authorization: `Bearer ${t16}` } });
    const own = await fetch(url, { headers: { Authorization: `Bearer ${t07}` } });
    return { other: other.status, otherBytes: (await other.arrayBuffer()).byteLength, own: own.status,
             ownType: own.headers.get('content-type'), ownBytes: (await own.arrayBuffer()).byteLength };
  }, { url: `${FILES}/${job.storagePath}`, t16: studentToken(T16, 'vidyuthsetu+t16@gmail.com'), t07: studentToken(T07, 'vidyuthsetu+t07@gmail.com') });
  check('4a second student (t16) is refused t07\'s audio', cross.other === 404 && cross.otherBytes < 100, `HTTP ${cross.other}`);
  check('4b owner (t07) control: same URL downloads', cross.own === 200 && cross.ownBytes > 1000, `HTTP ${cross.own} ${cross.ownType} ${cross.ownBytes} bytes`);
  const anon = await page.evaluate(async (url) => (await fetch(url)).status, `${FILES}/${job.storagePath}`);
  check('4c no token at all is refused', anon === 401, `HTTP ${anon}`);
} catch (e) {
  check(`(unexpected) ${e.message.slice(0, 200)}`, false);
  await page.screenshot({ path: 'voice-playback-fail.png' }).catch(() => {});
} finally {
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
