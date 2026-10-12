// S41: migration 111 recreates two functions the website calls that existed only in the live databases.
// OFFLINE on a real PostgreSQL 16 engine (PGlite): a database built from migrations alone gets them, and they work.
//   PGLITE_MODULE=file:///.../pglite/dist/index.js node --test scripts/dev-tools/sidhu_s41_live_only_functions.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const M111 = read("migration/111-capture-live-only-functions.sql");
const STAGE15 = read("supabase/migrations/20260821010000_stage15_tpo_foundations.sql");
const LOG_ACTIVITY = STAGE15.slice(STAGE15.indexOf("create or replace function public.log_activity("), STAGE15.indexOf("end $fn$;", STAGE15.indexOf("create or replace function public.log_activity(")) + 9);

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";
const ME = "00000000-0000-4000-8000-0000000000aa", OTHER = "00000000-0000-4000-8000-0000000000bb";

const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $f$;
grant usage on schema auth, public to anon, authenticated, service_role;
create table public.colleges (id uuid primary key);
create table public.user_roles (user_id uuid primary key, role text, has_completed_wizard boolean default false);
create table public.student_profiles (id uuid primary key, college_id uuid, onboarding_status text, last_active timestamptz);
create table public.student_activity_events (id bigint generated always as identity primary key, student_id uuid not null references public.student_profiles(id),
  college_id uuid, event_type text not null, source_type text, source_id uuid, occurred_at timestamptz not null default now(), metadata jsonb);
${LOG_ACTIVITY}
insert into public.user_roles values ('${ME}', 'student', false), ('${OTHER}', 'student', false);
insert into public.student_profiles values ('${ME}', null, 'invited', null), ('${OTHER}', null, 'invited', null);`;

async function db() { const d = new PGlite(); await d.exec(FIXTURE); await d.exec(M111); return d; }
async function as(d, role, sub, sql) {
  await d.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: sub ?? "" })}', false);`);
  try { return await d.query(sql); } finally { await d.exec("reset role"); }
}
const one = async (d, sql) => Object.values((await d.query(sql)).rows[0])[0];

test("a database built from migrations has both functions, callable by a signed-in user; 111 runs twice", { skip }, async () => {
  const d = await db();
  await d.exec(M111);
  assert.equal(await one(d, `select has_function_privilege('authenticated', 'public.complete_own_wizard()', 'execute')`), true);
  assert.equal(await one(d, `select has_function_privilege('authenticated', 'public.touch_my_activity()', 'execute')`), true);
});

test("complete_own_wizard: finishes only the caller's own onboarding; refuses a signed-out caller", { skip }, async () => {
  const d = await db();
  await as(d, "authenticated", ME, "select public.complete_own_wizard()");
  assert.deepEqual((await d.query(`select user_id::text, has_completed_wizard from public.user_roles order by user_id`)).rows,
    [{ user_id: ME, has_completed_wizard: true }, { user_id: OTHER, has_completed_wizard: false }]);
  assert.equal(await one(d, `select onboarding_status from public.student_profiles where id = '${ME}'`), "in_progress");
  assert.equal(await one(d, `select onboarding_status from public.student_profiles where id = '${OTHER}'`), "invited");
  await assert.rejects(as(d, "authenticated", null, "select public.complete_own_wizard()"), /not signed in/);
});

test("touch_my_activity: one login event a day for the caller, last_active set; nothing for a signed-out caller", { skip }, async () => {
  const d = await db();
  for (let i = 0; i < 3; i++) await as(d, "authenticated", ME, "select public.touch_my_activity()");
  assert.equal(await one(d, `select count(*)::int from public.student_activity_events where student_id = '${ME}' and event_type = 'login'`), 1);
  assert.notEqual(await one(d, `select last_active from public.student_profiles where id = '${ME}'`), null);
  await as(d, "authenticated", null, "select public.touch_my_activity()");
  assert.equal(await one(d, `select count(*)::int from public.student_activity_events`), 1);
});
