// S38 independent re-review of TEJA 7704a98 (the S36 fixes). OFFLINE. Database parts on PGlite (real PostgreSQL 16).
// Covers what the S36 tests left open, found by reverting each fix and seeing which revert no test noticed.
//
//   PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/sidhu_s38_rereview.test.mjs
//
// Without PGlite the database tests are SKIPPED, never passed. The CI workflow s38-security-regression.yml refuses skips.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const M105 = read("migration/105-live-controls.sql");
const M106 = read("migration/106-remove-students-restore-submissions-backup.sql");
const M107 = read("migration/107-consent-guard-and-login-tracking.sql");

// The shared fixture of s34_migration_105.test.mjs, read the same way sidhu_s36_security.test.mjs does.
const src = read("scripts/dev-tools/s34_migration_105.test.mjs");
const a = src.indexOf("const ID = {"), b = src.indexOf("async function database");
if (a < 0 || b < a) throw new Error("fixture anchors not found in s34_migration_105.test.mjs");
const { ID, FIXTURE } = new Function(`${src.slice(a, b)}; return { ID, FIXTURE };`)();

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped below */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

async function database(...migrations) {
  const db = new PGlite();
  await db.exec(FIXTURE);
  for (const m of migrations) await db.exec(m);
  return db;
}
async function as(db, role, userId, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId ?? "", role })}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
}
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const events = (db) => db.query(`select user_id::text, detail from public.security_events where event_type = 'voice_audio_sharing_changed' order by created_at`)
  .then((r) => r.rows.map((e) => ({ by: e.user_id, enabled: e.detail.enabled, student: e.detail.student_id })));

// ------------------------------------------------------------------ S36-03: one record per real change, ON and OFF
test("S38: the consent function writes exactly one record per change (the function no longer writes its own)", { skip }, async () => {
  const db = await database(M105, M106, M107);
  await as(db, "authenticated", ID.SA, `select public.set_share_voice_audio(true)`);
  assert.deepEqual(await events(db), [{ by: ID.SA, enabled: true, student: ID.SA }]);
});

test("S38: switching consent OFF is recorded with who did it; repeating the same value records nothing", { skip }, async () => {
  const db = await database(M105, M106, M107);
  await as(db, "authenticated", ID.SA, `select public.set_share_voice_audio(true)`);
  await as(db, "authenticated", ID.SA, `select public.set_share_voice_audio(true)`);                 // no change
  await as(db, "authenticated", ID.SA, `update public.student_profiles set share_voice_audio = true where id = '${ID.SA}'`);
  await as(db, "authenticated", ID.ADM, `update public.student_profiles set share_voice_audio = false where id = '${ID.SA}'`);
  assert.deepEqual(await events(db), [
    { by: ID.SA, enabled: true, student: ID.SA },
    { by: ID.ADM, enabled: false, student: ID.SA },
  ]);
});

// ------------------------------------------------------------------ S36-04: a rule saved "off" before 107
test("S38: a protected notice switched off before 107 is switched back on by 107, and delivered", { skip }, async () => {
  const db = await database(M105, M106);
  await db.exec(`insert into public.notification_rules (type, enabled) values ('review_outcome', false), ('college_linked', false)`);
  await db.exec(M107);
  assert.equal(await one(db, `select count(*)::int from public.notification_rules where not enabled`), 0);
});

// ------------------------------------------------------------------ S36-05: only self-deletion records lose the login id
test("S38: the login id is dropped only from a self-deletion record", { skip }, async () => {
  const db = await database(M105, M106, M107);
  await as(db, "service_role", null, `select * from public.remove_students(array['${ID.SA}']::uuid[], '${ID.SA}', 'self')`);
  assert.equal(await one(db, `select snapshot ->> 'provider_uid' from public.removed_students where student_id = '${ID.SA}'`), "google-a",
    "kept while the login still has to be deleted");
  await as(db, "service_role", null, `update public.removed_students set login_delete_attempts = 1 where student_id = '${ID.SA}'`);
  assert.equal(await one(db, `select snapshot ->> 'provider_uid' from public.removed_students where student_id = '${ID.SA}'`), "google-a",
    "a failed try does not lose it");
});

// ------------------------------------------------------------------ files_purged_at integrity: the job wiring itself
test("S38: the daily job marks files_purged_at only after removeOwnerFiles reported no failure", () => {
  const job = read("supabase/functions/scheduled-job/index.ts");
  const start = job.indexOf("if (job === 'prune-events')");
  assert.ok(start > 0, "purge block found");
  const block = job.slice(start, start + job.slice(start).search(/\r?\n  \}/));
  const purge = block.indexOf("removeOwnerFiles(");
  const guard = block.search(/if \(failed\.length\) \{[^\n]*continue; \}/);
  const mark = block.indexOf("files_purged_at: new Date()");
  assert.ok(purge > 0 && guard > purge && mark > guard, "purge, then skip on any failure, then mark: in that order");
  assert.equal(block.split("files_purged_at:").length - 1, 1, "one place marks a purge");
  assert.match(block, /\.is\('files_purged_at', null\)/, "only unpurged rows are read");
  assert.match(block, /\.eq\('reason', 'self'\)/, "only self-deletions: never a college or admin removal");
});

// ------------------------------------------------------------------ the student is not told more than is true
test("S38: no student screen offers self-deletion (the unused DeleteAccountDialog was removed, MF-102)", () => {
  assert.equal(existsSync(join(ROOT, "src/components/dashboard/student/DeleteAccountDialog.tsx")), false,
    "the self-delete dialog is gone; students cannot delete their own account (migration 138)");
  assert.doesNotMatch(read("src/components/dashboard/student/StudentSettingsPage.tsx"), /DeleteAccountDialog/,
    "Settings does not bring it back");
});

test("S38: the protected notices are locked in the admin window (S36-07), using the same list as 107", () => {
  const ui = read("src/components/dashboard/admin/NotificationRulesDialog.tsx");
  const list = ui.match(/ALWAYS_ON = new Set\(\[([^\]]*)\]\)/)?.[1].replace(/[\s"]/g, "").split(",").sort();
  const sql = M107.match(/_type in \(([^)]*)\)/)?.[1].replace(/[\s']/g, "").split(",").sort();
  assert.deepEqual(list, sql, "UI and database name the same protected types");
  assert.match(ui, /disabled=\{setRule\.isPending \|\| ALWAYS_ON\.has\(r\.type\)\}/, "the switch is disabled for them");
});
