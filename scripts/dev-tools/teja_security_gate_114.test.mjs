// Migration 114 (14 Oct security gate, run-1 P0) on a real PostgreSQL engine (PGlite). OFFLINE, IN-MEMORY.
// No network and no project database: every id below is a made-up fixture id.
//
//   PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/teja_security_gate_114.test.mjs
//
// The BEFORE state is the repository's own text: stage 1's colleges_own_update and student_profiles_own_insert,
// migration 84's keep_approval_closed function and triggers, and migration 100 applied exactly as written.
// 114 and its rollback are applied exactly as written. Each scenario runs as a real role with real claims, so RLS,
// WITH CHECK and BEFORE triggers are PostgreSQL's own behaviour. Without PGlite every test is SKIPPED.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const between = (text, from, to) => { const a = text.indexOf(from); const b = text.indexOf(to, a); assert.ok(a >= 0 && b > a, `${from} not found`); return text.slice(a, b + to.length); };

const STAGE1 = read("supabase/migrations/20260815000000_stage1_identity_and_intake.sql");
const STAGE1B = read("supabase/migrations/20260815000100_stage1_close_advisor_warnings.sql");
const M84 = read("migration/84-no-self-approval-and-d3-d4-locks.sql");
const M100 = read("migration/100-managed-accounts-only-policies.sql");
const M114 = read("migration/114-suspension-and-profile-insert-locks.sql");
const R114 = read("migration/114-rollback-suspension-and-profile-insert-locks.sql");
const MIRROR = read("supabase/migrations/20261103010400_suspension_and_profile_insert_locks.sql");

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped below */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const ID = {
  TPO: "00000000-0000-4000-8000-0000000000b1", TPO2: "00000000-0000-4000-8000-0000000000b2",
  CO: "00000000-0000-4000-8000-0000000000c1", ADM: "00000000-0000-4000-8000-0000000000e1",
  NEW: "00000000-0000-4000-8000-0000000000f9", NEW2: "00000000-0000-4000-8000-0000000000f8",
  C1: "00000000-0000-4000-8000-0000000001c1", C2: "00000000-0000-4000-8000-0000000001c2",
  S1: "00000000-0000-4000-8000-0000000002c1",
};

// Real policy / function text taken from the repository.
const BEFORE = [
  between(STAGE1B, "create policy colleges_own_update on public.colleges", "public.is_admin());\n"),
  between(STAGE1, "create policy student_profiles_own_insert on public.student_profiles", "public.is_admin());"),
  between(M84, "create or replace function public.keep_approval_closed()", "for each row execute function public.keep_approval_closed();\ndrop trigger if exists keep_approval_closed on public.startups;"),
  between(M84, "create trigger keep_approval_closed before insert or update on public.startups", "for each row execute function public.keep_approval_closed();\ndrop trigger if exists keep_approval_closed on public.colleges;"),
  between(M84, "create trigger keep_approval_closed before insert or update on public.colleges", "for each row execute function public.keep_approval_closed();"),
].join("\n");

const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create type public.app_role as enum ('admin', 'student', 'college_admin', 'startup', 'recruiter');
create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null unique, role public.app_role not null);
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') $$;
create table public.colleges (id uuid primary key default gen_random_uuid(), user_id uuid, name text,
  status text not null default 'active', verification_status text not null default 'pending');
create table public.startups (id uuid primary key default gen_random_uuid(), user_id uuid, name text,
  status text not null default 'pending', verification_status text not null default 'pending');
create table public.recruiters (id uuid primary key default gen_random_uuid(), user_id uuid,
  verified boolean default false, verified_at timestamptz, verified_by uuid);
create table public.student_profiles (id uuid primary key, user_id uuid unique, college_id uuid, full_name text,
  status text default 'active', total_xp integer default 0);
alter table public.user_roles enable row level security;
alter table public.colleges enable row level security;
alter table public.startups enable row level security;
alter table public.recruiters enable row level security;
alter table public.student_profiles enable row level security;
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
create policy all_read_colleges on public.colleges for select to authenticated using (true);
create policy all_read_startups on public.startups for select to authenticated using (true);
create policy own_read_profiles on public.student_profiles for select to authenticated using (true);
create policy user_roles_read on public.user_roles for select to authenticated using (true);
create policy startups_admin_write on public.startups for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- the three self-service policies migration 100 removes (stage 1 / 14 / 47 shapes) and the admin role insert it keeps
create policy user_roles_self_claim on public.user_roles for insert to authenticated
  with check (user_id = (select auth.uid()) and role = any (array['student'::app_role, 'college_admin'::app_role, 'startup'::app_role, 'recruiter'::app_role]));
create policy user_roles_admin_insert on public.user_roles for insert to authenticated with check (public.is_admin());
create policy colleges_own_insert on public.colleges for insert to authenticated with check (user_id = (select auth.uid()) or public.is_admin());
create policy startups_self_signup on public.startups for insert to authenticated with check (user_id = (select auth.uid()));
${BEFORE}
insert into public.user_roles (user_id, role) values
  ('${ID.TPO}', 'college_admin'), ('${ID.TPO2}', 'college_admin'), ('${ID.CO}', 'startup'), ('${ID.ADM}', 'admin');
insert into public.colleges (id, user_id, name, status, verification_status) values
  ('${ID.C1}', '${ID.TPO}', 'Suspended College', 'suspended', 'approved'),
  ('${ID.C2}', '${ID.TPO2}', 'Victim College', 'active', 'approved');
insert into public.startups (user_id, name, status, verification_status) values ('${ID.CO}', 'Co', 'suspended', 'approved');
insert into public.student_profiles (id, user_id, college_id, full_name) values ('${ID.S1}', '${ID.S1}', '${ID.C2}', 'Real student');
`;

async function database(...migrations) {
  const db = new PGlite();
  await db.exec(FIXTURE);
  for (const m of migrations) await db.exec(m);
  return db;
}
async function as(db, userId, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
}
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const refused = async (p) => { try { await p; return false; } catch (e) { return /row-level security|violates/.test(String(e.message)); } };
const unsuspend = (db) => as(db, ID.TPO, `update public.colleges set status = 'active' where id = '${ID.C1}'`);
const joinVictim = (db, who) => as(db, who, `insert into public.student_profiles (id, user_id, college_id, full_name) values ('${who}', '${who}', '${ID.C2}', 'Intruder')`);

test("114 mirror under supabase/migrations is byte-identical", () => assert.equal(MIRROR, M114));

test("BEFORE (100 applied, no 114): the gaps are real", { skip }, async () => {
  const db = await database(M100);
  await unsuspend(db);
  assert.equal(await one(db, `select status from public.colleges where id = '${ID.C1}'`), "active", "suspended owner lifted its suspension");
  await joinVictim(db, ID.NEW);
  assert.equal(await one(db, `select college_id from public.student_profiles where id = '${ID.NEW}'`), ID.C2, "a login joined another college");
});

test("114 refuses to run while migration 100 is not in effect", { skip }, async () => {
  const db = await database();
  await assert.rejects(db.exec(M114), /apply 100 first/);
  await db.exec("rollback");   // the failed migration's own transaction (a real psql run ends it with ON_ERROR_STOP)
  assert.equal(await one(db, `select position('new.status := old.status' in pg_get_functiondef('public.keep_approval_closed()'::regprocedure))`), 0, "nothing was changed");
});

test("AFTER 100 + 114: a suspended college owner cannot lift its suspension; verification_status still frozen", { skip }, async () => {
  const db = await database(M100, M114);
  await unsuspend(db);
  await as(db, ID.TPO, `update public.colleges set verification_status = 'approved', name = 'Renamed' where id = '${ID.C1}'`);
  const row = (await db.query(`select status, name from public.colleges where id = '${ID.C1}'`)).rows[0];
  assert.equal(row.status, "suspended");
  assert.equal(row.name, "Renamed", "control: the owner can still edit its own ordinary fields");
});

test("AFTER: a company owner cannot lift its own suspension (no owner update policy; the trigger also freezes it)", { skip }, async () => {
  const db = await database(M100, M114);
  await as(db, ID.CO, `update public.startups set status = 'active' where user_id = '${ID.CO}'`);
  assert.equal(await one(db, `select status from public.startups where user_id = '${ID.CO}'`), "suspended");
});

test("control: an administrator and the service role can still suspend and lift", { skip }, async () => {
  const db = await database(M100, M114);
  await as(db, ID.ADM, `update public.colleges set status = 'active' where id = '${ID.C1}'`);
  assert.equal(await one(db, `select status from public.colleges where id = '${ID.C1}'`), "active", "admin lifted");
  await db.exec(`set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    update public.colleges set status = 'suspended' where id = '${ID.C1}'; reset role; select set_config('request.jwt.claims', '', false);`);
  assert.equal(await one(db, `select status from public.colleges where id = '${ID.C1}'`), "suspended", "service role suspended");
});

test("AFTER: a login cannot insert a student profile naming a college, or with XP", { skip }, async () => {
  const db = await database(M100, M114);
  assert.ok(await refused(joinVictim(db, ID.NEW)), "profile naming a college was accepted");
  assert.ok(await refused(as(db, ID.NEW2, `insert into public.student_profiles (id, user_id, full_name, total_xp) values ('${ID.NEW2}', '${ID.NEW2}', 'x', 99999)`)), "XP accepted");
  assert.equal(await one(db, `select count(*)::int from public.student_profiles where id in ('${ID.NEW}', '${ID.NEW2}')`), 0);
});

test("control: the browser's own insert (ensureStudentProfile: user_id, full_name, total_xp 0) still works; admin may set a college", { skip }, async () => {
  const db = await database(M100, M114);
  await as(db, ID.NEW, `insert into public.student_profiles (id, user_id, full_name, total_xp) values ('${ID.NEW}', '${ID.NEW}', 'New', 0) on conflict (user_id) do nothing`);
  assert.equal(await one(db, `select count(*)::int from public.student_profiles where id = '${ID.NEW}' and college_id is null`), 1);
  await as(db, ID.ADM, `insert into public.student_profiles (id, user_id, college_id, full_name) values ('${ID.NEW2}', '${ID.NEW2}', '${ID.C2}', 'Admin-made')`);
  assert.equal(await one(db, `select college_id from public.student_profiles where id = '${ID.NEW2}'`), ID.C2);
});

test("rollback restores the BEFORE behaviour exactly; 114 then re-applies", { skip }, async () => {
  const db = await database(M100, M114, R114);
  await unsuspend(db);
  assert.equal(await one(db, `select status from public.colleges where id = '${ID.C1}'`), "active", "rollback did not restore 84's trigger");
  await db.exec(`update public.colleges set status = 'suspended' where id = '${ID.C1}'`);
  await db.exec(M114);
  await unsuspend(db);
  assert.equal(await one(db, `select status from public.colleges where id = '${ID.C1}'`), "suspended", "re-apply did not lock again");
});

test("existing rows are untouched by 114", { skip }, async () => {
  const db = await database(M100);
  const before = JSON.stringify((await db.query(`select * from public.colleges order by id`)).rows) + JSON.stringify((await db.query(`select * from public.student_profiles order by id`)).rows);
  await db.exec(M114);
  const after = JSON.stringify((await db.query(`select * from public.colleges order by id`)).rows) + JSON.stringify((await db.query(`select * from public.student_profiles order by id`)).rows);
  assert.equal(after, before);
});
