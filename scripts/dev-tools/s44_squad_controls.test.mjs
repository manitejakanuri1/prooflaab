// 144 (qualifier count) and 145 (move a student between sections), on a real PostgreSQL engine (PGlite), in memory.
// A small stand-in schema holds only the tables these two migrations touch; the migration files are the real ones.
//
//   PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/s44_squad_controls.test.mjs
//
// Without PGlite every test is SKIPPED, never passed; CI refuses skips.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped below */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const read = (f) => readFileSync(new URL(`../../migration/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const M144 = read("144-qualifier-setting.sql");
const R144 = read("144-rollback-qualifier-setting.sql");
const M145 = read("145-move-student-section.sql");
const R145 = read("145-rollback-move-student-section.sql");

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const C1 = U(1), C2 = U(2), TPO1 = U(11), TPO2 = U(12), SEASON = U(21);

const FIXTURE = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.colleges (id uuid primary key, user_id uuid, verification_status text default 'approved');
create table public.seasons (id uuid primary key, college_id uuid references public.colleges(id), is_current boolean default true);
create table public.squads (id uuid primary key default gen_random_uuid(), season_id uuid, college_id uuid, name text,
  cohort text, points integer default 0, wins integer default 0, qualified boolean, archived_at timestamptz);
create table public.student_profiles (id uuid primary key, college_id uuid, full_name text, cohort text);
create table public.squad_members (id uuid primary key default gen_random_uuid(), squad_id uuid, student_id uuid,
  joined_at timestamptz default now(), left_at timestamptz);
create table public.audit (action text, record uuid, old_v jsonb, new_v jsonb);

create function public.write_audit(a text, t text, r uuid, o jsonb, n jsonb, c uuid) returns void
  language sql as $$ insert into public.audit values (a, r, o, n) $$;
create function public.my_college_id() returns uuid language sql stable security definer
  set search_path = public, pg_temp as
  $$ select id from public.colleges where user_id = auth.uid() and verification_status = 'approved' limit 1 $$;
grant select on all tables in schema public to authenticated, service_role;
grant usage on schema public to authenticated;

insert into public.colleges (id, user_id) values ('${C1}', '${TPO1}'), ('${C2}', '${TPO2}');
insert into public.seasons (id, college_id) values ('${SEASON}', '${C1}');
`;

async function database() {
  const db = new PGlite();
  await db.exec(FIXTURE);
  // qualify_squads as deployed before 144 (the rollback file is that body): the starting point of the upgrade.
  await db.exec(R144.replace("drop function if exists public.tpo_set_qualifiers(integer);", "")
    .replace("drop function if exists public.tpo_qualifier_setting();", "")
    .replace("alter table public.colleges drop column if exists qualifiers_per_cohort;", ""));
  // Production state before 144: clients cannot call qualify_squads (migration 3100 revoked it).
  await db.exec(`revoke all on function public.qualify_squads(uuid) from public, anon, authenticated;`);
  await db.exec(M144);
  await db.exec(M145);
  return db;
}
async function as(db, role, userId, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId ?? "", role })}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
}
const addSquad = (db, name, cohort, points) =>
  db.exec(`insert into public.squads (season_id, college_id, name, cohort, points) values ('${SEASON}', '${C1}', '${name}', '${cohort}', ${points})`);
const qualified = async (db) => (await db.query(`select name from public.squads where qualified order by name`)).rows.map((r) => r.name);

// ------------------------------------------------------------------ 144
test("144: without a choice the old rule holds (2 per section with two sections)", { skip }, async () => {
  const db = await database();
  for (const [n, c, p] of [["A1", "A", 9], ["A2", "A", 8], ["A3", "A", 7], ["B1", "B", 9], ["B2", "B", 8], ["B3", "B", 7]]) await addSquad(db, n, c, p);
  const out = (await db.query(`select public.qualify_squads('${SEASON}') as r`)).rows[0].r;
  assert.equal(out.per_cohort, 2);
  assert.deepEqual(await qualified(db), ["A1", "A2", "B1", "B2"]);
});

test("144: one section and no choice sends four", { skip }, async () => {
  const db = await database();
  for (let i = 1; i <= 6; i++) await addSquad(db, `S${i}`, "A", 10 - i);
  const out = (await db.query(`select public.qualify_squads('${SEASON}') as r`)).rows[0].r;
  assert.equal(out.per_cohort, 4);
  assert.deepEqual(await qualified(db), ["S1", "S2", "S3", "S4"]);
});

test("144: a college that chooses 3 gets 3 per section, and null returns to the default", { skip }, async () => {
  const db = await database();
  for (const [n, c, p] of [["A1", "A", 9], ["A2", "A", 8], ["A3", "A", 7], ["A4", "A", 6], ["B1", "B", 9], ["B2", "B", 8], ["B3", "B", 7], ["B4", "B", 6]]) await addSquad(db, n, c, p);
  const set = (await as(db, "authenticated", TPO1, `select public.tpo_set_qualifiers(3) as r`)).rows[0].r;
  assert.equal(set.per_cohort, 3);
  const shown = (await as(db, "authenticated", TPO1, `select public.tpo_qualifier_setting() as r`)).rows[0].r;
  assert.equal(shown.per_cohort, 3); assert.equal(shown.default_per_cohort, 2); assert.equal(shown.cohorts, 2);
  await db.query(`select public.qualify_squads('${SEASON}')`);
  assert.deepEqual(await qualified(db), ["A1", "A2", "A3", "B1", "B2", "B3"]);
  await as(db, "authenticated", TPO1, `select public.tpo_set_qualifiers(null)`);
  await db.query(`select public.qualify_squads('${SEASON}')`);
  assert.deepEqual(await qualified(db), ["A1", "A2", "B1", "B2"]);
});

test("144: the setting is limited to 1..8 and only an approved college can set it", { skip }, async () => {
  const db = await database();
  await assert.rejects(as(db, "authenticated", TPO1, `select public.tpo_set_qualifiers(0)`), /between 1 and 8/);
  await assert.rejects(as(db, "authenticated", TPO1, `select public.tpo_set_qualifiers(9)`), /between 1 and 8/);
  await assert.rejects(as(db, "authenticated", U(99), `select public.tpo_set_qualifiers(2)`), /Only a college/);
  await assert.rejects(as(db, "anon", null, `select public.tpo_set_qualifiers(2)`), /permission denied/);
  await assert.rejects(as(db, "authenticated", TPO1, `select public.qualify_squads('${SEASON}')`), /permission denied/);
});

test("144: one college's choice never changes another college's season", { skip }, async () => {
  const db = await database();
  await as(db, "authenticated", TPO2, `select public.tpo_set_qualifiers(5)`);
  for (const [n, c, p] of [["A1", "A", 9], ["A2", "A", 8], ["A3", "A", 7], ["B1", "B", 9], ["B2", "B", 8], ["B3", "B", 7]]) await addSquad(db, n, c, p);
  const out = (await db.query(`select public.qualify_squads('${SEASON}') as r`)).rows[0].r;
  assert.equal(out.per_cohort, 2, "season of college 1 ignores college 2's setting");
});

// ------------------------------------------------------------------ 145
const student = (db, id, college, name, cohort) =>
  db.exec(`insert into public.student_profiles (id, college_id, full_name, cohort) values ('${id}', '${college}', '${name}', ${cohort ? `'${cohort}'` : "null"})`);

test("145: moving a student changes the section and releases a squad seat of the old section", { skip }, async () => {
  const db = await database();
  await addSquad(db, "A1", "CSE-A", 0);
  const sq = (await db.query(`select id from public.squads where name = 'A1'`)).rows[0].id;
  await student(db, U(31), C1, "Ravi", "CSE-A");
  await db.exec(`insert into public.squad_members (squad_id, student_id) values ('${sq}', '${U(31)}')`);
  const r = (await as(db, "authenticated", TPO1, `select public.tpo_move_student_section('${U(31)}', 'CSE-B') as r`)).rows[0].r;
  assert.equal(r.changed, true); assert.equal(r.released_squad, true); assert.equal(r.from, "CSE-A");
  assert.equal((await db.query(`select cohort from public.student_profiles where id = '${U(31)}'`)).rows[0].cohort, "CSE-B");
  const m = (await db.query(`select left_at from public.squad_members where student_id = '${U(31)}'`)).rows;
  assert.equal(m.length, 1, "the history row is kept, not deleted");
  assert.ok(m[0].left_at, "the seat is closed");
  assert.equal((await db.query(`select count(*)::int as n from public.audit where action = 'STUDENT_SECTION_MOVED'`)).rows[0].n, 1);
});

test("145: a student in a squad of the section they move to keeps the seat", { skip }, async () => {
  const db = await database();
  await addSquad(db, "B1", "CSE-B", 0);
  const sq = (await db.query(`select id from public.squads where name = 'B1'`)).rows[0].id;
  await student(db, U(32), C1, "Priya", "CSE-A");
  await db.exec(`insert into public.squad_members (squad_id, student_id) values ('${sq}', '${U(32)}')`);
  const r = (await as(db, "authenticated", TPO1, `select public.tpo_move_student_section('${U(32)}', 'cse-b') as r`)).rows[0].r;
  assert.equal(r.released_squad, false);
  assert.equal((await db.query(`select left_at from public.squad_members where student_id = '${U(32)}'`)).rows[0].left_at, null);
});

test("145: a name that differs only by case reuses the existing section spelling; same section is a no-op", { skip }, async () => {
  const db = await database();
  await student(db, U(33), C1, "A", "CSE-A"); await student(db, U(34), C1, "B", "CSE-B");
  const r = (await as(db, "authenticated", TPO1, `select public.tpo_move_student_section('${U(33)}', ' cse-b ') as r`)).rows[0].r;
  assert.equal(r.cohort, "CSE-B");
  const same = (await as(db, "authenticated", TPO1, `select public.tpo_move_student_section('${U(33)}', 'CSE-B') as r`)).rows[0].r;
  assert.equal(same.changed, false);
  const secs = (await as(db, "authenticated", TPO1, `select public.tpo_sections() as r`)).rows[0].r;
  assert.deepEqual(secs, [{ cohort: "CSE-B", students: 2 }]);
});

test("145: only the student's own college may move them; bad input and other roles are refused", { skip }, async () => {
  const db = await database();
  await student(db, U(35), C1, "Mine", "CSE-A"); await student(db, U(36), C2, "Theirs", "CSE-A");
  await assert.rejects(as(db, "authenticated", TPO1, `select public.tpo_move_student_section('${U(36)}', 'CSE-B')`), /another college/);
  await assert.rejects(as(db, "authenticated", TPO1, `select public.tpo_move_student_section('${U(35)}', '   ')`), /Choose a section/);
  await assert.rejects(as(db, "authenticated", TPO1, `select public.tpo_move_student_section('${U(35)}', '${"x".repeat(61)}')`), /too long/);
  await assert.rejects(as(db, "authenticated", TPO1, `select public.tpo_move_student_section('${U(77)}', 'CSE-B')`), /No such student/);
  await assert.rejects(as(db, "authenticated", U(99), `select public.tpo_move_student_section('${U(35)}', 'CSE-B')`), /Only a college/);
  await assert.rejects(as(db, "anon", null, `select public.tpo_move_student_section('${U(35)}', 'CSE-B')`), /permission denied/);
  assert.equal((await db.query(`select cohort from public.student_profiles where id = '${U(36)}'`)).rows[0].cohort, "CSE-A");
});

// ------------------------------------------------------------------ rollbacks
test("rollbacks remove the new functions; the old qualification rule is back; both migrations can be applied again", { skip }, async () => {
  const db = await database();
  await db.exec(R145); await db.exec(R144);
  await assert.rejects(db.query(`select public.tpo_set_qualifiers(2)`), /does not exist/);
  await assert.rejects(db.query(`select public.tpo_move_student_section('${U(1)}', 'X')`), /does not exist/);
  const cols = (await db.query(`select 1 from information_schema.columns where table_name = 'colleges' and column_name = 'qualifiers_per_cohort'`)).rows;
  assert.equal(cols.length, 0);
  for (const [n, c, p] of [["A1", "A", 9], ["A2", "A", 8], ["A3", "A", 7], ["B1", "B", 9], ["B2", "B", 8], ["B3", "B", 7]]) await addSquad(db, n, c, p);
  await db.query(`select public.qualify_squads('${SEASON}')`);
  assert.deepEqual(await qualified(db), ["A1", "A2", "B1", "B2"]);
  await db.exec(M144); await db.exec(M145);
});
