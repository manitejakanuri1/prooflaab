// Step 6: real-browser STAGING check of the Build-Log recordings card:
// status, provenance and score badges vs the database (each row found by its
// exact voice id), the real "Too little speech" reason, authenticated blob
// playback (the student's own Authorization header; failure, retry, clean-up on
// close) and cross-student audio isolation. Uses existing staging rows only:
// creates, changes and deletes nothing. Genuine Google sign-in is NOT exercised
// (the session is minted like the staging auth-bridge issues it).
//
// Needs `npx vite --mode staging --port 5173 --strictPort` running, and:
//   STAGING_JWT="$(gcloud secrets versions access latest --secret=prooflab-staging-jwt-secret)" \
//     node scripts/dev-tools/voice_buildlog_browser.mjs
// Tokens are minted in memory like the staging auth-bridge issues them, never printed.
import { chromium } from 'playwright';
import crypto from 'node:crypto';

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
const tok = (id, email) => mint({ role: 'authenticated', sub: id, email });
const SVC = mint({ role: 'service_role', sub: 'voice-buildlog-test' }, 3600);
const session = (id, email) => {
  const t = tok(id, email);
  return { access_token: t, provider_token: t, refresh_token: 'browser-test-no-refresh', expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200, token_type: 'bearer',
    user: { id, email, aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(),
            last_sign_in_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, identities: [] } };
};

// Independent statements of the expected badges (not imported from the app).
function expectedProvenance(r) {
  const t = r.transcription_status ?? 'completed';
  if (t === 'pending' || t === 'processing') return 'Verifying';
  if (t === 'failed') return 'Verification failed';
  return r.transcript_source === 'server' ? 'Server-verified' : 'Self-reported';
}
function expected(r) {
  const t = r.transcription_status ?? 'completed';
  if (t === 'failed') return 'Failed';
  if (t === 'pending' || t === 'processing') return 'Transcribing';
  if (r.status === 'scored') return 'Scored';
  if (r.status === 'failed') return 'Not scored';
  return r.transcript_source === 'server' ? 'Scoring' : 'Not scored';
}

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const t07Session = session(T07, 'vidyuthsetu+t07@gmail.com');
await ctx.addInitScript((s) => { if (!localStorage.getItem('prooflab.auth.google')) localStorage.setItem('prooflab.auth.google', JSON.stringify(s)); },
  t07Session);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  pageerror: ${e.message.slice(0, 160)}`));

try {
  // Same rows the card shows: t07's latest 20.
  const db = await (await fetch(`${API}/voice_explanations?student_id=eq.${T07}&select=id,transcription_status,transcript_source,status,storage_path,communication_score,communication_notes&order=created_at.desc&limit=20`,
    { headers: { Authorization: `Bearer ${SVC}` } })).json();

  await page.goto(`${APP}/student/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Build-Log/ }).first().click({ timeout: 60000 });
  await page.getByText(/Spoken Explanations/).first().waitFor({ timeout: 60000 });
  await page.locator('[data-voice-id]').first().waitFor({ timeout: 30000 });

  // 1. Every badge matches the database.
  const shown = await page.locator('[data-voice-id]').evaluateAll((els) => els.map((el) => ({
    id: el.getAttribute('data-voice-id'),
    label: el.querySelector('[data-status]')?.textContent?.trim() ?? null,
    provenance: el.querySelector('[data-provenance]')?.textContent?.trim() ?? null,
    score: el.querySelector('[data-score]')?.getAttribute('data-score') ?? null,
  })));
  const mismatches = [];
  const counts = {};
  for (const r of db) {
    const s = shown.find((x) => x.id === r.id);
    const want = expected(r);
    counts[want] = (counts[want] ?? 0) + 1;
    if (!s || s.label !== want) mismatches.push(`${r.id.slice(0, 8)} want=${want} got=${s?.label}`);
  }
  check('1a every badge matches the database rules', mismatches.length === 0 && shown.length === db.length,
    mismatches.length ? mismatches.join('; ') : `${shown.length} rows ${JSON.stringify(counts)}`);
  check('1b no row says "Completed" any more', !shown.some((s) => s.label === 'Completed'));
  const tooShort = db.find((r) => r.status === 'failed' && r.transcript_source === 'server');
  check('1c a "too little speech" row shows "Not scored"', !!tooShort && shown.find((s) => s.id === tooShort.id)?.label === 'Not scored');
  const legacy = db.find((r) => r.transcript_source !== 'server' && r.status !== 'scored');
  check('1d a self-reported unscored row shows "Not scored", not pending',
    legacy ? shown.find((s) => s.id === legacy.id)?.label === 'Not scored' : true,
    legacy ? '' : 'none in the latest 20 (covered by unit tests)');

  // 1e/1f. Provenance and score badges in the LIST, row by row, by exact id.
  const provMismatch = [];
  const scoreMismatch = [];
  for (const r of db) {
    const s = shown.find((x) => x.id === r.id);
    if (s?.provenance !== expectedProvenance(r)) provMismatch.push(`${r.id.slice(0, 8)} want=${expectedProvenance(r)} got=${s?.provenance}`);
    const wantScore = expected(r) === 'Scored' && r.communication_score != null ? String(r.communication_score) : null;
    if ((s?.score ?? null) !== wantScore) scoreMismatch.push(`${r.id.slice(0, 8)} want=${wantScore} got=${s?.score}`);
  }
  const provCounts = {};
  for (const s of shown) provCounts[s.provenance] = (provCounts[s.provenance] ?? 0) + 1;
  check('1e provenance badge in the list matches the database for every row', provMismatch.length === 0,
    provMismatch.length ? provMismatch.join('; ') : JSON.stringify(provCounts));
  check('1f a number is shown only on Scored rows, and it is the saved score', scoreMismatch.length === 0,
    scoreMismatch.length ? scoreMismatch.join('; ') : `${shown.filter((s) => s.score).length} numbers shown`);
  const contradictory = shown.filter((s) => s.score && s.label !== 'Scored');
  check('1g no contradictory "Not scored/Failed/Scoring + NN/100" in the list', contradictory.length === 0);

  // 1h. The exact too-short recording, opened by voice id: the real reason is shown.
  const shortRow = db.find((r) => r.status === 'failed' && r.communication_notes === 'Too little speech to score.');
  if (shortRow) {
    await page.locator(`[data-voice-id="${shortRow.id}"]`).click();
    const d = page.getByRole('dialog');
    await d.waitFor({ timeout: 10000 });
    const reasonShown = await d.getByText('Too little speech to score.', { exact: true }).isVisible();
    const badge = (await d.locator('[data-status]').first().textContent())?.trim();
    const numberShown = await d.locator('[data-score]').count();
    check('1h exact too-short recording: detail shows "Too little speech to score.", Not scored, no number',
      reasonShown && badge === 'Not scored' && numberShown === 0, `voice ${shortRow.id.slice(0, 8)}`);
    await page.keyboard.press('Escape');
    await d.waitFor({ state: 'detached', timeout: 10000 });
  } else {
    check('1h exact too-short recording present in the latest 20', false, 'none found');
  }

  // 2. Detail playback: authenticated blob, failure, retry, clean-up on close.
  const target = db.find((r) => r.status === 'scored' && r.transcript_source === 'server');
  // opened by its exact voice id
  await page.locator(`[data-voice-id="${target.id}"]`).click();
  const dlg = page.getByRole('dialog');
  let downloads = 0;
  const authSeen = [];
  page.on('request', async (r) => {
    if (!r.url().startsWith(FILES)) return;
    downloads++;
    const h = (await r.allHeaders())['authorization'] ?? '';
    // Compared, never printed: exactly the signed-in student's token.
    authSeen.push({ bearer: h.startsWith('Bearer '), same: h === `Bearer ${t07Session.access_token}`,
      sub: (() => { try { return JSON.parse(Buffer.from(h.split('.')[1] ?? '', 'base64url').toString()).sub; } catch { return null; } })() });
  });
  await page.route(`${FILES}/**`, (r) => r.abort('failed'));
  await dlg.getByRole('button', { name: /Play recording/ }).click();
  await dlg.getByRole('button', { name: /Could not load - try again/ }).waitFor({ timeout: 15000 });
  check('2a failed download: retry button shown and enabled (not stuck)',
    await dlg.getByRole('button', { name: /Could not load - try again/ }).isEnabled());
  await page.unroute(`${FILES}/**`);
  await dlg.getByRole('button', { name: /Could not load - try again/ }).click();
  const audio = dlg.locator('audio').first();
  await audio.waitFor({ timeout: 30000 });
  const a = await audio.evaluate((el) => new Promise((res) => {
    const done = () => res({ src: el.src, ready: el.readyState });
    if (el.readyState >= 1) done(); else { el.onloadedmetadata = done; el.onerror = () => res({ src: el.src, ready: -1 }); setTimeout(done, 15000); }
  }));
  check('2b retry plays through a blob: URL (no signed/shareable link)', a.src.startsWith('blob:') && a.ready >= 1, `ready=${a.ready}`);
  check('2c the download went to files-service with the student token', downloads >= 2, `requests=${downloads}`);
  const okAuth = authSeen.length > 0 && authSeen.every((a) => a.bearer && a.same && a.sub === T07);
  check("2e every download carried the signed-in student's own Authorization header (value not printed)", okAuth,
    `${authSeen.length} request(s), sub=${authSeen[0]?.sub === T07 ? 't07' : authSeen[0]?.sub}`);
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'detached', timeout: 10000 });
  const revoked = await page.evaluate(async (u) => { try { await fetch(u); return false; } catch { return true; } }, a.src);
  check('2d blob URL revoked when the dialog closes', revoked);

  // 3. Another student cannot download this audio.
  const cross = await page.evaluate(async ({ url, t16, t07 }) => {
    const other = await fetch(url, { headers: { Authorization: `Bearer ${t16}` } });
    const own = await fetch(url, { headers: { Authorization: `Bearer ${t07}` } });
    return { other: other.status, own: own.status, ownBytes: (await own.arrayBuffer()).byteLength };
  }, { url: `${FILES}/${target.storage_path}`, t16: tok(T16, 'vidyuthsetu+t16@gmail.com'), t07: tok(T07, 'vidyuthsetu+t07@gmail.com') });
  check('3a second student (t16) refused', cross.other === 404, `HTTP ${cross.other}`);
  check('3b owner control succeeds', cross.own === 200 && cross.ownBytes > 1000, `HTTP ${cross.own}, ${cross.ownBytes} bytes`);
} catch (e) {
  check(`(unexpected) ${e.message.slice(0, 200)}`, false);
  await page.screenshot({ path: 'voice-buildlog-fail.png' }).catch(() => {});
} finally {
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
