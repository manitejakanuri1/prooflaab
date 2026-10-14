// S41: student write actions that had no test: start a task (start_task_assignment, migration 08), consent to voice
// recording (accept_voice_consent, stage 33) and ask for today's Lot (create_my_lot, stage 25). OFFLINE on
// PostgreSQL 16 (PGlite) with the DEPLOYED bodies. create_lot_for (the large Lot engine, tested elsewhere) is replaced
// by a recorder: the question here is only whom a student can act for.
//   PGLITE_MODULE=file:///.../pglite/dist/index.js node --test scripts/dev-tools/sidhu_s41_student_writes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { read } from "./sidhu_s39_squad_fixture.mjs";

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const cut = (file, start, end) => { const t = read(file).replace(/\r\n/g, "\n"); const a = t.indexOf(start); const b = t.indexOf(end, a); if (a < 0 || b < 0) throw new Error(`${start} not in ${file}`); return t.slice(a, b + end.length); };
const DEPLOYED = [
  cut("migration/08-google-stale-function-bodies.sql", "CREATE OR REPLACE FUNCTION public.start_task_assignment(", "$function$\n;").replace(/\r/g, ""),
  cut("supabase/migrations/20260901000000_stage33_phase1_flow_corrections.sql", "create or replace function public.accept_voice_consent()", "end $fn$;"),
  cut("supabase/migrations/20260824000000_stage25_daily_lot_engine.sql", "create or replace function public.create_my_lot()", "end $fn$;"),
].join("\n");

const ME = "00000000-0000-4000-8000-0000000000a1", YOU = "00000000-0000-4000-8000-0000000000a2", CO = "00000000-0000-4000-8000-00000000c001";
const T = { MINE: "00000000-0000-4000-8000-0000000071a1", YOURS: "00000000-0000-4000-8000-0000000071a2", ASSIGNED: "00000000-0000-4000-8000-0000000071a3" };
const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $f$;
grant usage on schema auth, public to anon, authenticated, service_role;
create table public.student_profiles (id uuid primary key, user_id uuid, voice_consent_at timestamptz);
create table public.tasks (id uuid primary key, student_id uuid, started_at timestamptz, status text);
create table public.task_assignments (task_id uuid, student_id uuid, status text, updated_at timestamptz);
create table public.lot_requests (student uuid, day date);
create function public.create_lot_for(_s uuid, _d date) returns jsonb language sql security definer set search_path = public, pg_temp as
  $f$ insert into public.lot_requests values (_s, _d); select jsonb_build_object('created', true) $f$;
${DEPLOYED}
revoke all on function public.create_lot_for(uuid, date) from public, anon, authenticated;
insert into public.student_profiles values ('${ME}', '${ME}', null), ('${YOU}', '${YOU}', null);
insert into public.tasks values ('${T.MINE}', '${ME}', null, 'Assigned'), ('${T.YOURS}', '${YOU}', null, 'Assigned'), ('${T.ASSIGNED}', null, null, 'Open');
insert into public.task_assignments values ('${T.ASSIGNED}', '${ME}', 'assigned', null);`;

async function db() { const d = new PGlite(); await d.exec(FIXTURE); return d; }
async function as(d, sub, sql) {
  await d.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: sub ?? "" })}', false);`);
  try { return await d.query(sql); } finally { await d.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}
const one = async (d, sql) => Object.values((await d.query(sql)).rows[0] ?? { v: null })[0];
const start = (task) => `select public.start_task_assignment('${task}') as r`;

test("start a task: my own task and a task assigned to me start once; the start time is kept", { skip }, async () => {
  const d = await db();
  assert.deepEqual((await as(d, ME, start(T.MINE))).rows[0].r, { ok: true });
  assert.deepEqual((await d.query(`select status, started_at is not null as s from public.tasks where id = '${T.MINE}'`)).rows[0], { status: "In Progress", s: true });
  const first = await one(d, `select started_at::text from public.tasks where id = '${T.MINE}'`);
  await as(d, ME, start(T.MINE));
  assert.equal(await one(d, `select started_at::text from public.tasks where id = '${T.MINE}'`), first, "starting again keeps the first time");
  assert.deepEqual((await as(d, ME, start(T.ASSIGNED))).rows[0].r, { ok: true });
  assert.equal(await one(d, `select status from public.task_assignments`), "in_progress");
  assert.deepEqual((await as(d, ME, start(T.ASSIGNED))).rows[0].r, { ok: false, reason: "not assigned to you, or already started" });
});

test("start a task: someone else's task, an unknown task, no profile, signed out: refused, nothing changes", { skip }, async () => {
  const d = await db();
  assert.deepEqual((await as(d, ME, start(T.YOURS))).rows[0].r, { ok: false, reason: "not assigned to you, or already started" });
  assert.equal(await one(d, `select started_at from public.tasks where id = '${T.YOURS}'`), null);
  assert.equal((await as(d, ME, start("00000000-0000-4000-8000-00000000ffff"))).rows[0].r.reason, "no such task");
  assert.equal((await as(d, CO, start(T.MINE))).rows[0].r.reason, "no student profile");
  assert.equal((await as(d, null, start(T.MINE))).rows[0].r.reason, "not authenticated");
  assert.equal(await one(d, `select count(*)::int from public.tasks where started_at is not null`), 0);
});

test("voice consent: only the caller's own profile, first time kept, signed-out refused", { skip }, async () => {
  const d = await db();
  const first = (await as(d, ME, "select public.accept_voice_consent() as t")).rows[0].t;
  assert.ok(first);
  const again = (await as(d, ME, "select public.accept_voice_consent() as t")).rows[0].t;
  assert.equal(String(again), String(first), "the first consent time is kept");
  assert.equal(await one(d, `select voice_consent_at from public.student_profiles where id = '${YOU}'`), null);
  await assert.rejects(as(d, null, "select public.accept_voice_consent()"), /not signed in/);
});

test("today's Lot: always for the caller, for today; signed-out refused; the engine itself is not callable from the browser", { skip }, async () => {
  const d = await db();
  await as(d, ME, "select public.create_my_lot()");
  assert.deepEqual((await d.query(`select student::text, day = current_date as today from public.lot_requests`)).rows, [{ student: ME, today: true }]);
  await assert.rejects(as(d, null, "select public.create_my_lot()"), /not signed in/);
  await assert.rejects(as(d, ME, `select public.create_lot_for('${YOU}', current_date)`), /permission denied/);
  assert.equal(await one(d, `select count(*)::int from public.lot_requests`), 1);
});
