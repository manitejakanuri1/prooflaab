// S34 QA: migration 105 breaks student removal; migration 106 repairs it. Real PostgreSQL (PGlite, in-memory).
//   PGLITE_MODULE=<file URL of @electric-sql/pglite/dist/index.js> node --test scripts/dev-tools/sidhu_s34_remove_students.test.mjs
// The schema is the slice remove_students() touches, AFTER migration 66 (public.proof_uploads dropped).
// 105's remove_students is loaded exactly as the 105 file writes it; 106 is applied exactly as written.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const m105 = read("migration/105-live-controls.sql");
const a = m105.indexOf("create or replace function public.remove_students(");
const REMOVE_105 = m105.slice(a, m105.indexOf("$$;", m105.indexOf("as $$", a) + 5) + 3);
const M106 = read("migration/106-remove-students-restore-submissions-backup.sql");
const S1 = "00000000-0000-4000-8000-000000000001", S2 = "00000000-0000-4000-8000-000000000002", S3 = "00000000-0000-4000-8000-000000000003";
const TPO = "00000000-0000-4000-8000-0000000000c1", ADM = "00000000-0000-4000-8000-0000000000e1";

let mod, available = true;
before(async () => { try { mod = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite"); } catch { available = false; } });
const need = (t) => { if (!available) t.skip("PGlite not installed (set PGLITE_MODULE)"); return available; };

async function world({ apply106 }) {
  const db = new mod.PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create table public.user_roles (user_id uuid, role text);
    create table public.colleges (id uuid primary key, user_id uuid);
    create table public.student_profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, college_id uuid);
    create table public.student_contact (student_id uuid); create table public.squad_members (student_id uuid);
    create table public.tasks (student_id uuid); create table public.task_submissions (student_id uuid, code text);
    create table public.resume_scorecards (student_id uuid); create table public.student_tracks (student_id uuid);
    create table public.student_levels (student_id uuid); create table public.voice_explanations (student_id uuid, storage_path text);
    create table public.account_identities (user_id uuid); create table public.student_intake (user_id uuid);
    create table public.removed_students (id bigserial, student_id uuid, college_id uuid, email text, full_name text, removed_by uuid, reason text, snapshot jsonb, files_purged_at timestamptz);
    create function public.student_logins() returns table(student_id uuid, provider_uid text, email text)
      language sql as $f$ select id, 'uid-' || id::text, 'synthetic@invalid.test' from public.student_profiles $f$;
    insert into auth.users values ('${S1}'), ('${S2}'), ('${S3}'), ('${TPO}'), ('${ADM}');
    insert into public.colleges values ('00000000-0000-4000-8000-0000000001c1', '${TPO}');
    insert into public.user_roles values ('${ADM}', 'admin');
    insert into public.student_profiles values ('${S1}', 'A', '00000000-0000-4000-8000-0000000001c1'), ('${S2}', 'B', '00000000-0000-4000-8000-0000000001c1'), ('${S3}', 'C', '00000000-0000-4000-8000-0000000001c1');
    insert into public.task_submissions values ('${S2}', 'graded work'), ('${S1}', 'mine');
    insert into public.voice_explanations values ('${S1}', 'voice/${S1}/a.webm');`);
  await db.exec(REMOVE_105);
  await db.exec(`revoke all on function public.remove_students(uuid[], uuid, text) from public, anon, authenticated;
                 grant execute on function public.remove_students(uuid[], uuid, text) to service_role;`);
  if (apply106) await db.exec(M106);
  return db;
}
const remove = (db, ids, by, reason) => db.query(`select * from public.remove_students($1::uuid[], $2::uuid, $3)`, [ids, by, reason]);

test("105 alone: every removal path fails (proof_uploads was dropped by migration 66)", async (t) => {
  if (!need(t)) return;
  for (const [ids, by, reason] of [[[S1], S1, "self"], [[S2], TPO, "college"], [[S2], ADM, "admin"], [[S2], null, "console_sync"]]) {
    const db = await world({ apply106: false });
    await assert.rejects(remove(db, ids, by, reason), /proof_uploads/, reason);
  }
});

test("105 + 106: self, college, admin and console-sync removal all work", async (t) => {
  if (!need(t)) return;
  for (const [ids, by, reason] of [[[S1], S1, "self"], [[S2], TPO, "college"], [[S2], ADM, "admin"], [[S3], null, "console_sync"]]) {
    const db = await world({ apply106: true });
    const r = await remove(db, ids, by, reason);
    assert.equal(r.rows.length, 1, reason);
    assert.equal((await db.query(`select count(*)::int n from auth.users where id = $1`, [ids[0]])).rows[0].n, 0, `${reason}: account gone`);
  }
});

test("106 restores migration 65's backup of graded work; self-deletion keeps no copy of the work", async (t) => {
  if (!need(t)) return;
  const db = await world({ apply106: true });
  await remove(db, [S2], TPO, "college");
  await remove(db, [S1], S1, "self");
  const college = (await db.query(`select snapshot from public.removed_students where student_id = $1`, [S2])).rows[0].snapshot;
  assert.deepEqual(college.submissions, [{ student_id: S2, code: "graded work" }]);
  assert.equal("proofs" in college, false);
  const self = (await db.query(`select snapshot from public.removed_students where student_id = $1`, [S1])).rows[0].snapshot;
  assert.deepEqual(Object.keys(self).sort(), ["self_requested", "voice_files"]);
  assert.deepEqual(self.voice_files, [`voice/${S1}/a.webm`]);
});

test("105's rules still hold after 106: self only for yourself, a college only for its own students", async (t) => {
  if (!need(t)) return;
  const db = await world({ apply106: true });
  await assert.rejects(remove(db, [S2], S1, "self"), /only your own account/);
  await assert.rejects(remove(db, [S1, S2], S1, "self"), /only your own account/);
  await assert.rejects(remove(db, [S2], S1, "college"), /only a college or an administrator/);
});

test("106 is idempotent and keeps the function's privileges", async (t) => {
  if (!need(t)) return;
  const db = await world({ apply106: true });
  await db.exec(M106);   // second run: notice, no change
  const p = (await db.query(`select has_function_privilege('authenticated', 'public.remove_students(uuid[],uuid,text)', 'execute') as auth,
                                    has_function_privilege('service_role', 'public.remove_students(uuid[],uuid,text)', 'execute') as svc`)).rows[0];
  assert.deepEqual(p, { auth: false, svc: true });
});
