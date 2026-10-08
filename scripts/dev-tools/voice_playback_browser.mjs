// Step 6: real-browser STAGING check of recording playback after a refresh (in the recording
// dialog), the Play button's failure handling, and cross-student audio isolation.
//
// Needs `npx vite --mode staging --port 5173 --strictPort` running, and:
// Tokens: signed like the staging bridge (RS256, F1) by ./staging_token.mjs - needs gcloud access to staging secrets.
//     node scripts/dev-tools/voice_playback_browser.mjs <speech.wav>
// Tokens are minted in memory (like the staging auth-bridge issues them) and
// never printed. Makes one real staging recording and one DeepSeek call.
import { chromium } from 'playwright';
import { cookieSignIn, credentialsFor, signedInUserId } from "./bff_login.mjs";

const WAV = process.argv[2];
// SIGN-IN (changed 8 Oct 2026): the site keeps its session in the web BFF's HttpOnly cookie and ignores
// browser storage, so this signs in for real through the form (./bff_login.mjs). It needs a site served
// WITH the BFF (E2E_BASE, e.g. the staging site - a bare `vite` server has no /api) and a dedicated test
// login in the environment: E2E_STUDENT_EMAIL / _PASSWORD / _ID, and a SECOND student E2E_STUDENT2_EMAIL / _PASSWORD for step 4. The browser now calls same-origin /api/db, /api/functions and
// /api/files, so those are the addresses intercepted below. NOT RUN since this change.
const APP = (process.env.E2E_BASE ?? '').replace(/\/$/, '');
if (!APP) throw new Error('set E2E_BASE to a site served with the web BFF (for example the staging site)');
const FILES = `${APP}/api/files/voice-explanations`;
const T07 = process.env.E2E_STUDENT_ID;   // account id of the E2E_STUDENT_* test login (checked after sign-in)
if (!T07) throw new Error('set E2E_STUDENT_ID to the account id of the E2E_STUDENT_* test login');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
});
const ctx = await browser.newContext({ permissions: ['microphone'] });
await cookieSignIn(ctx, APP, credentialsFor('student'));
if ((await signedInUserId(ctx, APP)) !== T07) throw new Error('E2E_STUDENT_ID is not the signed-in test student');
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
  // The modal keeps one record per recording under pl.voiceJob.v3:<recordingId> (src/lib/voiceJob.ts),
  // carrying studentId/taskId - not the older pl.voiceJob.<student>.<task> keys.
  job = await page.evaluate((id) => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith('pl.voiceJob.v3:')) continue;
      const j = JSON.parse(localStorage.getItem(k));
      if (j?.studentId === id) return j;
    }
    return null;
  }, T07);
  check('1 recording saved and queued', !!job?.voiceId, `voice ${job?.voiceId?.slice(0, 8)}`);

  // Reopen THE SAME task: the list order changes once a task has a recording.
  const [task] = await page.evaluate(async (id) => await (await fetch(`/api/db/tasks?id=eq.${id}&select=title`, { credentials: 'same-origin' })).json(), job.taskId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Heartbeat contract (src/lib/voiceLifecycle.ts): a record's heartbeat older than HEARTBEAT_STALE_MS
  // (15 s) means its page is gone. The queued record still carries the previous page's fresh heartbeat,
  // and the dialog checks ownership once per opening - opened sooner, it shows "still being sent from
  // another open tab" until reopened (reported in docs/DEAD-CODE-AND-DATABASE-CLEANUP-2026-10-07.md).
  await page.waitForTimeout(16000);
  await page.locator('[class*="border-l-4"]').filter({ has: page.getByRole('heading', { name: task.title, exact: true }) })
    .getByRole('button', { name: /Explain 60s/ }).first().click({ timeout: 60000 });
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

  // (Former step 3 - playing the recording from the Build-Log's "Spoken Explanations" list - was
  // removed with that screen in 292358b: the Build-log shows marks only; playback lives in this
  // dialog (step 2) and on the Privacy page.)

  // 4. A second student cannot download the first student's audio (from the browser origin).
  // Each student is its own browser with its own cookie; nobody holds a token to pass around.
  const probe = async (target, url) => await target.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'same-origin' });
    return { status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength };
  }, url);
  const otherCtx = await browser.newContext();
  await cookieSignIn(otherCtx, APP, credentialsFor('student2'));
  const otherPage = await otherCtx.newPage();
  await otherPage.goto(`${APP}/auth`, { waitUntil: 'domcontentloaded' });
  const theirs = await probe(otherPage, `${FILES}/${job.storagePath}`);
  const mine = await probe(page, `${FILES}/${job.storagePath}`);
  await otherCtx.close();
  const cross = { other: theirs.status, otherBytes: theirs.bytes, own: mine.status, ownType: mine.type, ownBytes: mine.bytes };
  check('4a second student is refused the first student\'s audio', cross.other === 404 && cross.otherBytes < 100, `HTTP ${cross.other}`);
  check('4b owner control: same URL downloads', cross.own === 200 && cross.ownBytes > 1000, `HTTP ${cross.own} ${cross.ownType} ${cross.ownBytes} bytes`);
  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage();
  await anonPage.goto(`${APP}/auth`, { waitUntil: 'domcontentloaded' });
  const anon = (await probe(anonPage, `${FILES}/${job.storagePath}`)).status;
  await anonCtx.close();
  check('4c no session at all is refused', anon === 401, `HTTP ${anon}`);
} catch (e) {
  check(`(unexpected) ${e.message.slice(0, 200)}`, false);
  await page.screenshot({ path: 'voice-playback-fail.png' }).catch(() => {});
} finally {
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
