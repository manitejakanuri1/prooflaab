// S36 independent security QA of migrations 105 + 106 + 107, on a real PostgreSQL engine (PGlite). OFFLINE, IN-MEMORY.
// Reuses the fixture of s34_migration_105.test.mjs (read from that file, so both always test the same schema slice).
//
//   PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/sidhu_s36_security.test.mjs
//
// Tests named "REPRO S36-xx" PASS WHILE THE FINDING EXISTS. When a finding is fixed, its REPRO test fails: then turn
// it into a normal test of the fixed behaviour. Without PGlite every test is SKIPPED, never passed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const M105 = read("migration/105-live-controls.sql");
const M106 = read("migration/106-remove-students-restore-submissions-backup.sql");
const M107 = read("migration/107-consent-guard-and-login-tracking.sql");
const R107 = read("migration/107-rollback-consent-guard-and-login-tracking.sql");

// The shared fixture: everything from `const ID = {` up to `async function database` in Teja's test.
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
const rs = (db) => one(db, `select pg_get_functiondef('public.remove_students(uuid[],uuid,text)'::regprocedure)`);

// ------------------------------------------------------------------ ordering and rollback safety
test("107 before 106 (staging's current state + 107 only) is refused as a whole; nothing is half-applied", { skip }, async () => {
  const db = await database(M105);
  await assert.rejects(db.exec(M107), /requires migration 106/);
  await db.exec("rollback"); // psql ON_ERROR_STOP ends the session here; the transaction never commits
  assert.equal(await one(db, `select count(*)::int from pg_trigger where tgname = 'student_profiles_guard_share_voice_audio'`), 0);
  assert.equal(await one(db, `select count(*)::int from information_schema.columns where table_name = 'removed_students' and column_name = 'login_deleted_at'`), 0);
  assert.ok(!(await rs(db)).includes("-- 107"), "remove_students untouched");
});

test("106 and 107 are each idempotent: applied twice, one login-id line, same owner/grants", { skip }, async () => {
  const db = await database(M105, M106, M107);
  const acl = await one(db, `select proacl::text from pg_proc where oid = 'public.remove_students(uuid[],uuid,text)'::regprocedure`);
  await db.exec(M106); await db.exec(M107);
  assert.equal((await rs(db)).split("'provider_uid', s.provider_uid, -- 107").length - 1, 1);
  assert.equal(await one(db, `select proacl::text from pg_proc where oid = 'public.remove_students(uuid[],uuid,text)'::regprocedure`), acl);
});

test("107 rollback, then 107 again: guard back, consent stays off, removal still works", { skip }, async () => {
  const db = await database(M105, M106, M107);
  await as(db, "authenticated", ID.SA, `select public.set_share_voice_audio(true)`);
  await db.exec(R107);
  assert.equal(await one(db, `select count(*)::int from public.student_profiles where share_voice_audio`), 0);
  await db.exec(M107);
  await assert.rejects(as(db, "authenticated", ID.ADM, `update public.student_profiles set share_voice_audio = true where id = '${ID.SB}'`), /only the student/);
  assert.equal((await as(db, "service_role", null, `select * from public.remove_students(array['${ID.SB}']::uuid[], '${ID.ADM}', 'admin')`)).rows.length, 1);
});

test("consent guard: a student cannot switch ANOTHER student on, even through the security-definer RPC path", { skip }, async () => {
  const db = await database(M105, M106, M107);
  const r = await as(db, "authenticated", ID.SA, `update public.student_profiles set share_voice_audio = true where id = '${ID.SB}' returning id`);
  assert.equal(r.rows.length, 0, "RLS hides the other row");
  // a forged claim cannot help: the guard compares the row id with the caller id
  await assert.rejects(as(db, "service_role", ID.SA, `update public.student_profiles set share_voice_audio = true where id = '${ID.SB}'`), /only the student/);
  assert.equal(await one(db, `select share_voice_audio from public.student_profiles where id = '${ID.SB}'`), false);
});

// ------------------------------------------------------------------ findings (REPRO = passes while the finding exists)
// S36-03, S36-04 and S36-05 were REPRO tests (they passed while the finding existed). TEJA fixed the findings in
// migration 107 (S36), so they are normal tests now and fail if a fix is lost.
test("S36-03 fixed: a student's direct table write that switches consent ON is recorded, like the RPC path", { skip }, async () => {
  const db = await database(M105, M106, M107);
  // Staging (read-only check, 9 Oct): authenticated has UPDATE on student_profiles.share_voice_audio and the
  // student_profiles_own_update policy, so PATCH /api/db/student_profiles?id=eq.<me> {share_voice_audio:true} works.
  await as(db, "authenticated", ID.SA, `update public.student_profiles set share_voice_audio = true where id = '${ID.SA}'`);
  assert.equal(await one(db, `select share_voice_audio from public.student_profiles where id = '${ID.SA}'`), true);
  assert.equal(await one(db, `select count(*)::int from public.security_events where event_type = 'voice_audio_sharing_changed' and user_id = '${ID.SA}' and detail ->> 'enabled' = 'true'`), 1,
    "who gave consent, and when, is recorded");
});

test("S36-04 fixed (defence in depth): a protected notice is delivered even if its rule row is off", { skip }, async () => {
  const db = await database(M105, M106, M107);
  // Neither the browser nor the server role can write the table (good): only the database owner, e.g. a later migration.
  await assert.rejects(as(db, "service_role", null, `insert into public.notification_rules (type, enabled) values ('review_outcome', false)`), /permission denied/);
  await assert.rejects(as(db, "authenticated", ID.ADM, `insert into public.notification_rules (type, enabled) values ('review_outcome', false)`), /permission denied/);
  await db.exec(`insert into public.notification_rules (type, enabled) values ('review_outcome', false)`);
  await as(db, "service_role", null, `insert into public.notifications (user_id, type, title) values ('${ID.SA}', 'review_outcome', 't')`);
  assert.equal(await one(db, `select count(*)::int from public.notifications where type = 'review_outcome'`), 1,
    "the trigger that drops notices knows the protected list too");
});

test("S36-05 partly fixed: the login id leaves the record once the login is confirmed deleted; email and name are an owner decision", { skip }, async () => {
  const db = await database(M105, M106, M107);
  await as(db, "service_role", null, `select * from public.remove_students(array['${ID.SA}']::uuid[], '${ID.SA}', 'self')`);
  await as(db, "service_role", null, `update public.removed_students set login_deleted_at = now(), files_purged_at = now() where student_id = '${ID.SA}'`);
  const r = (await db.query(`select email, full_name, snapshot from public.removed_students where student_id = '${ID.SA}'`)).rows[0];
  assert.equal(r.email, "a@example.test");
  assert.equal(r.full_name, "Student A");
  assert.equal(r.snapshot.provider_uid, undefined, "the login id is cleared the moment login_deleted_at is set");
  // STILL OPEN (owner decision, no retention period set): email and full name stay in the record, asserted above.
});
