// S34: migration 105 executed on a real PostgreSQL engine. OFFLINE, IN-MEMORY, THROWAWAY.
//
// Uses PGlite (PostgreSQL compiled to WebAssembly, inside this Node process), the same way as
// sidhu_s30_pg_harness.mjs. It is NOT a project database: nothing is read from or written to staging or production.
// PGlite is not a repository dependency: point PGLITE_MODULE at an install of @electric-sql/pglite. Without it every
// test here is SKIPPED, never passed.
//
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/s34_migration_105.test.mjs
//
// The fixture holds only the tables and columns migration 105 touches, and a short stand-in for
// recruiter_proof_profile that contains the same anchor line as migration 64's body. Migration 105 and its rollback
// are applied exactly as written in the files. Each scenario runs as a real role (SET ROLE) with real claims.
// Limit: this is not the full schema. The first run against the real schema is still the staging run.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = readFileSync(join(ROOT, "migration/105-live-controls.sql"), "utf8");
const ROLLBACK = readFileSync(join(ROOT, "migration/105-rollback-live-controls.sql"), "utf8");

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped below */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const ID = {
  SA: "00000000-0000-4000-8000-0000000000a1", SB: "00000000-0000-4000-8000-0000000000a2",
  CO: "00000000-0000-4000-8000-0000000000d1", CO_UNVERIFIED: "00000000-0000-4000-8000-0000000000d2",
  ADM: "00000000-0000-4000-8000-0000000000e1", COLLEGE: "00000000-0000-4000-8000-0000000001c1",
  VA: "00000000-0000-4000-8000-00000000f0a1", VA_WITHDRAWN: "00000000-0000-4000-8000-00000000f0a2",
  VA_BROWSER: "00000000-0000-4000-8000-00000000f0a3", VB: "00000000-0000-4000-8000-00000000f0b1",
};

const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table public.user_roles (user_id uuid primary key references auth.users on delete cascade, role text not null);
create function public.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role = 'admin') $$;
create table public.colleges (id uuid primary key, user_id uuid);
create table public.student_profiles (id uuid primary key references auth.users on delete cascade, full_name text, college_id uuid,
  status text default 'active', profile_visibility text default 'public');
create table public.student_portfolios (student_id uuid primary key references auth.users on delete cascade, is_public boolean default false);
create table public.student_contact (student_id uuid primary key references auth.users on delete cascade, email text);
create table public.student_intake (user_id uuid primary key, intake_completed_at timestamptz);
create table public.account_identities (user_id uuid primary key, provider_uid text not null);
create table public.squad_members (student_id uuid references auth.users on delete cascade);
create table public.tasks (id uuid primary key default gen_random_uuid(), student_id uuid references auth.users on delete cascade, title text);
create table public.proof_uploads (student_id uuid references auth.users on delete cascade);
create table public.resume_scorecards (student_id uuid references auth.users on delete cascade);
create table public.student_tracks (student_id uuid references auth.users on delete cascade);
create table public.student_levels (student_id uuid references auth.users on delete cascade);
create table public.voice_explanations (id uuid primary key, student_id uuid references auth.users on delete cascade, task_id uuid,
  storage_path text, duration_seconds integer, communication_score integer, communication_notes text,
  transcript_source text, status text, current_authoritative boolean default true, withdrawn_at timestamptz, created_at timestamptz default now());
create table public.recruiters (id uuid primary key references auth.users on delete cascade, company text, verified boolean default false);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type text not null, title text, created_at timestamptz default now());
create table public.security_events (id uuid primary key default gen_random_uuid(), event_type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  source text not null default 'server' check (source in ('server', 'client')),
  user_id uuid references auth.users(id) on delete set null, detail jsonb not null default '{}'::jsonb, created_at timestamptz default now());

-- migration 17, verbatim table definition
create table public.removed_students (
  id uuid primary key default gen_random_uuid(), student_id uuid not null, college_id uuid, email text, full_name text,
  removed_by uuid, reason text not null check (reason in ('college', 'admin', 'console_sync')),
  snapshot jsonb not null, removed_at timestamptz not null default now());
alter table public.removed_students enable row level security;
revoke all on table public.removed_students from public, anon, authenticated;
grant select, insert on table public.removed_students to service_role;

create function public.student_logins() returns table (student_id uuid, provider_uid text, email text)
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select i.user_id, i.provider_uid, u.email from public.account_identities i join auth.users u on u.id = i.user_id
   where exists (select 1 from public.student_profiles p where p.id = i.user_id) $$;
create function public.student_is_discoverable(_student_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from public.student_profiles p join public.student_portfolios f on f.student_id = p.id
                  where p.id = _student_id and p.status = 'active' and p.profile_visibility = 'public' and f.is_public = true);
$fn$;
-- stand-in with migration 64's anchor line
create function public.recruiter_proof_profile(_student_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare p record;
begin
  select * into p from public.student_profiles where id = _student_id;
  return jsonb_build_object('explanations', (select coalesce(jsonb_agg(v order by v.created_at desc), '[]'::jsonb) from (
        select ve.id, ve.duration_seconds, ve.communication_score,
               ve.communication_notes, ve.created_at,
               (select t.title from public.tasks t where t.id = ve.task_id) as about
          from public.voice_explanations ve
         where ve.student_id = p.id and ve.communication_score is not null) v));
end $function$;

-- the browser role can update profiles as on the real schema (own row or admin); RLS is what the guard must outlast
alter table public.student_profiles enable row level security;
create policy own_or_admin on public.student_profiles for all to authenticated
  using (id = (select auth.uid()) or public.is_admin()) with check (id = (select auth.uid()) or public.is_admin());
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on table public.removed_students from authenticated;
grant execute on function public.is_admin() to authenticated, service_role;

insert into auth.users (id, email) values
  ('${ID.SA}', 'a@example.test'), ('${ID.SB}', 'b@example.test'), ('${ID.CO}', 'co@example.test'),
  ('${ID.CO_UNVERIFIED}', 'co2@example.test'), ('${ID.ADM}', 'adm@example.test');
insert into public.user_roles values ('${ID.SA}', 'student'), ('${ID.SB}', 'student'), ('${ID.CO}', 'startup'), ('${ID.CO_UNVERIFIED}', 'startup'), ('${ID.ADM}', 'admin');
insert into public.student_profiles (id, full_name, college_id) values ('${ID.SA}', 'Student A', '${ID.COLLEGE}'), ('${ID.SB}', 'Student B', '${ID.COLLEGE}');
insert into public.student_portfolios values ('${ID.SA}', true), ('${ID.SB}', true);
insert into public.account_identities values ('${ID.SA}', 'google-a'), ('${ID.SB}', 'google-b');
insert into public.recruiters values ('${ID.CO}', 'Acme', true), ('${ID.CO_UNVERIFIED}', 'Pending Ltd', false);
insert into public.voice_explanations (id, student_id, storage_path, communication_score, transcript_source, status, withdrawn_at) values
  ('${ID.VA}', '${ID.SA}', '${ID.SA}/a.webm', 80, 'server', 'scored', null),
  ('${ID.VA_WITHDRAWN}', '${ID.SA}', '${ID.SA}/w.webm', 70, 'server', 'scored', now()),
  ('${ID.VA_BROWSER}', '${ID.SA}', '${ID.SA}/b.webm', 70, 'browser', 'scored', null),
  ('${ID.VB}', '${ID.SB}', '${ID.SB}/b.webm', 75, 'server', 'scored', null);
`;

async function database() {
  const db = new PGlite();
  await db.exec(FIXTURE);
  await db.exec(MIGRATION);
  return db;
}
/** Runs sql as a role with a signed-in user id, then returns to the owner. */
async function as(db, role, userId, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId ?? "", role })}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
}
const refused = (p, re) => assert.rejects(p, re);
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const play = (db, company, voice) => as(db, "service_role", null, `select public.company_voice_recording('${company}', '${voice}') as path`).then((r) => r.rows[0].path);

test("105 applies as written, and its own self-check passes", { skip }, async () => {
  const db = await database();
  assert.equal(await one(db, `select count(*)::int from public.student_profiles where share_voice_audio`), 0);
});

test("consent: only the student can switch audio sharing on", { skip }, async () => {
  const db = await database();
  await as(db, "authenticated", ID.SA, `select public.set_share_voice_audio(true)`);
  assert.equal(await one(db, `select share_voice_audio from public.student_profiles where id = '${ID.SA}'`), true);
  assert.equal(await one(db, `select share_voice_audio from public.student_profiles where id = '${ID.SB}'`), false, "another student is untouched");
  assert.equal(await one(db, `select count(*)::int from public.security_events where event_type = 'voice_audio_sharing_changed' and user_id = '${ID.SA}'`), 1);

  // An administrator CAN update any profile row (the real policy allows it) but can never give consent for a student.
  await refused(as(db, "authenticated", ID.ADM, `update public.student_profiles set share_voice_audio = true where id = '${ID.SB}'`), /only the student/);
  await as(db, "authenticated", ID.ADM, `update public.student_profiles set full_name = 'Student B2' where id = '${ID.SB}'`); // other columns still work
  // Neither can the backend, nor a new row that arrives already switched on.
  await refused(as(db, "service_role", null, `update public.student_profiles set share_voice_audio = true where id = '${ID.SB}'`), /only the student/);
  await db.exec(`insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000a9')`);
  await refused(as(db, "service_role", null, `insert into public.student_profiles (id, share_voice_audio) values ('00000000-0000-4000-8000-0000000000a9', true)`), /only the student/);
  // Anyone who may update the row may switch it OFF.
  await as(db, "authenticated", ID.ADM, `update public.student_profiles set share_voice_audio = false where id = '${ID.SA}'`);
  assert.equal(await one(db, `select share_voice_audio from public.student_profiles where id = '${ID.SA}'`), false);
  // A company or a signed-out caller has no profile to switch.
  await refused(as(db, "authenticated", ID.CO, `select public.set_share_voice_audio(true)`), /only a student/);
  await refused(as(db, "anon", null, `select public.set_share_voice_audio(true)`), /permission denied/);
});

test("company voice play: every condition is required, and every listen is recorded", { skip }, async () => {
  const db = await database();
  assert.equal(await play(db, ID.CO, ID.VA), null, "no consent yet");
  await as(db, "authenticated", ID.SA, `select public.set_share_voice_audio(true)`);
  assert.equal(await play(db, ID.CO, ID.VA), `${ID.SA}/a.webm`);
  assert.equal(await one(db, `select detail ->> 'voice_id' from public.security_events where event_type = 'company_voice_played' and user_id = '${ID.CO}'`), ID.VA);

  assert.equal(await play(db, ID.CO_UNVERIFIED, ID.VA), null, "unverified company");
  assert.equal(await play(db, ID.SB, ID.VA), null, "a student is not a company");
  assert.equal(await play(db, ID.ADM, ID.VA), null, "an administrator is not a company");
  assert.equal(await play(db, ID.CO, ID.VA_WITHDRAWN), null, "withdrawn recording");
  assert.equal(await play(db, ID.CO, ID.VA_BROWSER), null, "transcript not verified by the server");
  assert.equal(await play(db, ID.CO, ID.VB), null, "another student who did not consent");
  assert.equal(await play(db, ID.CO, "00000000-0000-4000-8000-00000000ffff"), null, "no such recording");

  await db.exec(`update public.student_profiles set profile_visibility = 'college' where id = '${ID.SA}'`);
  assert.equal(await play(db, ID.CO, ID.VA), null, "student no longer discoverable");
  await db.exec(`update public.student_profiles set profile_visibility = 'public' where id = '${ID.SA}'`);
  await db.exec(`update public.student_portfolios set is_public = false where student_id = '${ID.SA}'`);
  assert.equal(await play(db, ID.CO, ID.VA), null, "portfolio switched off");
  await db.exec(`update public.student_portfolios set is_public = true where student_id = '${ID.SA}'`);
  await as(db, "authenticated", ID.SA, `select public.set_share_voice_audio(false)`);
  assert.equal(await play(db, ID.CO, ID.VA), null, "consent withdrawn");

  assert.equal(await one(db, `select count(*)::int from public.security_events where event_type = 'company_voice_played'`), 1, "refusals are not recorded as listens");
  // The browser role can never call it, whoever is signed in.
  await refused(as(db, "authenticated", ID.CO, `select public.company_voice_recording('${ID.CO}', '${ID.VA}')`), /permission denied/);
  await refused(as(db, "anon", null, `select public.company_voice_recording('${ID.CO}', '${ID.VA}')`), /permission denied/);
});

test("the company profile reports which recordings can be played", { skip }, async () => {
  const db = await database();
  const shared = async () => (await one(db, `select public.recruiter_proof_profile('${ID.SA}')`)).explanations.map((e) => [e.id, e.audio_shared]);
  assert.ok((await shared()).every(([, on]) => on === false));
  await as(db, "authenticated", ID.SA, `select public.set_share_voice_audio(true)`);
  const now = Object.fromEntries(await shared());
  assert.equal(now[ID.VA], true);
  assert.equal(now[ID.VA_WITHDRAWN], false);
});

test("notification rules: off stops new rows of that type only; admin only", { skip }, async () => {
  const db = await database();
  const send = (type) => as(db, "service_role", null, `insert into public.notifications (user_id, type, title) values ('${ID.SA}', '${type}', 't')`);
  const count = (type) => one(db, `select count(*)::int from public.notifications where type = '${type}'`);
  await send("weekly_progress");
  assert.equal(await count("weekly_progress"), 1);
  await refused(as(db, "authenticated", ID.SA, `select public.admin_set_notification_rule('weekly_progress', false)`), /only an administrator/);
  await refused(as(db, "anon", null, `select public.admin_set_notification_rule('weekly_progress', false)`), /permission denied/);
  await as(db, "authenticated", ID.ADM, `select public.admin_set_notification_rule('weekly_progress', false)`);
  await send("weekly_progress"); await send("review_outcome");
  assert.equal(await count("weekly_progress"), 1, "switched off: not created");
  assert.equal(await count("review_outcome"), 1, "other types unaffected");
  const rules = (await as(db, "authenticated", ID.ADM, `select * from public.admin_notification_rules()`)).rows;
  assert.deepEqual(rules.map((r) => [r.type, r.enabled, Number(r.sent_90d)]), [["review_outcome", true, 1], ["weekly_progress", false, 1]]);
  await as(db, "authenticated", ID.ADM, `select public.admin_set_notification_rule('weekly_progress', true)`);
  await send("weekly_progress");
  assert.equal(await count("weekly_progress"), 2);
  assert.equal(await one(db, `select count(*)::int from public.security_events where event_type = 'notification_rule_changed' and user_id = '${ID.ADM}'`), 2);
  await refused(as(db, "authenticated", ID.ADM, `select * from public.notification_rules`), /permission denied/);
});

test("email templates: admin only, validated, removable, never readable as a table", { skip }, async () => {
  const db = await database();
  await refused(as(db, "authenticated", ID.SA, `select public.admin_save_email_template('student', 'Hello', 'Welcome to the platform')`), /only an administrator/);
  await refused(as(db, "authenticated", ID.CO, `select * from public.admin_email_templates()`), /only an administrator/);
  await as(db, "authenticated", ID.ADM, `select public.admin_save_email_template('student', '  Hello {{name}}  ', 'Welcome to the platform')`);
  assert.deepEqual((await as(db, "authenticated", ID.ADM, `select key, subject, intro from public.admin_email_templates()`)).rows,
    [{ key: "student", subject: "Hello {{name}}", intro: "Welcome to the platform" }]);
  await refused(as(db, "authenticated", ID.ADM, `select public.admin_save_email_template('nobody', 'Hello', 'Welcome to the platform')`), /check/);
  await refused(as(db, "authenticated", ID.ADM, `select public.admin_save_email_template('student', 'Hi', 'short')`), /check/);
  await refused(as(db, "authenticated", ID.ADM, `select * from public.email_templates`), /permission denied/);
  assert.equal((await as(db, "service_role", null, `select subject from public.email_templates where key = 'student'`)).rows[0].subject, "Hello {{name}}");
  await as(db, "authenticated", ID.ADM, `select public.admin_save_email_template('student', '', '')`);
  assert.equal(await one(db, `select count(*)::int from public.email_templates`), 0);
  assert.equal(await one(db, `select count(*)::int from public.security_events where event_type = 'email_template_changed'`), 2);
});

test("delete my account: own account only, no copy of the work kept, server role only", { skip }, async () => {
  const db = await database();
  const remove = (ids, by, reason) => as(db, "service_role", null, `select * from public.remove_students(array[${ids.map((i) => `'${i}'`).join(",")}]::uuid[], '${by}', '${reason}')`);
  await refused(remove([ID.SB], ID.SA, "self"), /only your own account/);
  await refused(remove([ID.SA, ID.SB], ID.SA, "self"), /only your own account/);
  await refused(as(db, "authenticated", ID.SA, `select * from public.remove_students(array['${ID.SA}']::uuid[], '${ID.SA}', 'self')`), /permission denied/);
  assert.equal((await remove([ID.CO], ID.CO, "self")).rows.length, 0, "a company is not a student: nothing removed");
  assert.equal(await one(db, `select count(*)::int from auth.users where id = '${ID.CO}'`), 1);

  const out = await remove([ID.SA], ID.SA, "self");
  assert.deepEqual(out.rows, [{ student_id: ID.SA, provider_uid: "google-a", email: "a@example.test" }]);
  for (const t of ["auth.users where id", "public.student_profiles where id", "public.voice_explanations where student_id", "public.account_identities where user_id"]) {
    assert.equal(await one(db, `select count(*)::int from ${t} = '${ID.SA}'`), 0, t);
  }
  assert.equal(await one(db, `select count(*)::int from public.student_profiles where id = '${ID.SB}'`), 1, "nobody else is removed");
  const rec = (await db.query(`select reason, snapshot, login_deleted_at, files_purged_at from public.removed_students where student_id = '${ID.SA}'`)).rows[0];
  assert.equal(rec.reason, "self");
  assert.deepEqual(Object.keys(rec.snapshot).sort(), ["provider_uid", "self_requested"], "no profile, contact, tasks or voice rows are kept");
  assert.equal(rec.login_deleted_at, null);
  assert.equal(rec.files_purged_at, null);
  // The server can record the two follow-ups and nothing else on that row.
  await as(db, "service_role", null, `update public.removed_students set login_deleted_at = now(), files_purged_at = now() where student_id = '${ID.SA}'`);
  // A college or admin removal still keeps its snapshot (unchanged behaviour).
  await remove([ID.SB], ID.ADM, "admin");
  assert.ok("profile" in (await one(db, `select snapshot from public.removed_students where student_id = '${ID.SB}'`)));
});

test("the rollback applies as written and leaves no consent switched on", { skip }, async () => {
  const db = await database();
  await as(db, "authenticated", ID.SA, `select public.set_share_voice_audio(true)`);
  await db.exec(ROLLBACK);
  assert.equal(await one(db, `select count(*)::int from public.student_profiles where share_voice_audio`), 0);
  assert.equal(await one(db, `select count(*)::int from pg_proc where proname in ('company_voice_recording', 'set_share_voice_audio', 'apply_notification_rules', 'guard_share_voice_audio')`), 0);
  assert.ok(!("audio_shared" in (await one(db, `select public.recruiter_proof_profile('${ID.SA}')`)).explanations[0]));
  await as(db, "service_role", null, `insert into public.notifications (user_id, type, title) values ('${ID.SA}', 'x', 't')`); // trigger gone, inserts work
  // 105 can be applied again after a rollback.
  await db.exec(MIGRATION);
});
