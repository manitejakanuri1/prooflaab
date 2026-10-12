// S41: the review queue (needs_review_submissions, stage 70) shows students' names, scores and code, so who sees which
// rows matters. It had no test. OFFLINE on PostgreSQL 16 (PGlite) with the DEPLOYED body.
//   PGLITE_MODULE=file:///.../pglite/dist/index.js node --test scripts/dev-tools/sidhu_s41_review_queue.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { read } from "./sidhu_s39_squad_fixture.mjs";

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const S70 = read("supabase/migrations/20261001000800_stage70_rubric_tasks.sql").replace(/\r\n/g, "\n");
const a = S70.indexOf("create or replace function public.needs_review_submissions()");
const BODY = S70.slice(a, S70.indexOf("$$;", S70.indexOf("order by s.created_at asc;", a)) + 3);
const ID = { ADMIN: "00000000-0000-4000-8000-0000000000ad", TPO_A: "00000000-0000-4000-8000-00000000a0a1", TPO_B: "00000000-0000-4000-8000-00000000a0b1",
  TPO_P: "00000000-0000-4000-8000-00000000a0c1", A: "00000000-0000-4000-8000-00000000c0a1", B: "00000000-0000-4000-8000-00000000c0b1",
  P: "00000000-0000-4000-8000-00000000c0c1", SA: "00000000-0000-4000-8000-0000000005a1", SB: "00000000-0000-4000-8000-0000000005b1",
  SP: "00000000-0000-4000-8000-0000000005c1", T: "00000000-0000-4000-8000-0000000071a1" };
const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $f$;
grant usage on schema auth, public to anon, authenticated, service_role;
create table public.user_roles (user_id uuid, role text);
create function public.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as
  $f$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') $f$;
create table public.colleges (id uuid primary key, user_id uuid, verification_status text);
create table public.student_profiles (id uuid primary key, college_id uuid, full_name text);
create table public.tasks (id uuid primary key, title text);
create table public.task_submissions (id uuid primary key default gen_random_uuid(), task_id uuid, student_id uuid, status text,
  sandbox_score integer, flags text[], rubric_scores jsonb, code text, created_at timestamptz default clock_timestamp());
${BODY}
-- the deployed grants (stage 70)
revoke all on function public.needs_review_submissions() from public, anon;
grant execute on function public.needs_review_submissions() to authenticated;
insert into public.user_roles values ('${ID.ADMIN}', 'admin');
insert into public.colleges values ('${ID.A}', '${ID.TPO_A}', 'approved'), ('${ID.B}', '${ID.TPO_B}', 'approved'), ('${ID.P}', '${ID.TPO_P}', 'pending');
insert into public.student_profiles values ('${ID.SA}', '${ID.A}', 'Asha'), ('${ID.SB}', '${ID.B}', 'Bala'), ('${ID.SP}', '${ID.P}', 'Priya');
insert into public.tasks values ('${ID.T}', 'Two sum');
insert into public.task_submissions (task_id, student_id, status, sandbox_score) values
  ('${ID.T}', '${ID.SA}', 'needs_review', 60), ('${ID.T}', '${ID.SB}', 'needs_review', 70), ('${ID.T}', '${ID.SP}', 'needs_review', 80),
  ('${ID.T}', '${ID.SA}', 'passed', 100);`;

async function db() { const d = new PGlite(); await d.exec(FIXTURE); return d; }
async function names(d, sub) {
  await d.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: sub ?? "" })}', false);`);
  try { return (await d.query(`select student_name from public.needs_review_submissions()`)).rows.map((r) => r.student_name).sort(); }
  finally { await d.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}

test("review queue: an admin sees every flagged answer, and only flagged ones", { skip }, async () => {
  assert.deepEqual(await names(await db(), ID.ADMIN), ["Asha", "Bala", "Priya"]);
});

test("review queue: an approved college sees only its own students; a pending college, a student and a signed-out caller see nothing", { skip }, async () => {
  const d = await db();
  assert.deepEqual(await names(d, ID.TPO_A), ["Asha"]);
  assert.deepEqual(await names(d, ID.TPO_B), ["Bala"]);
  assert.deepEqual(await names(d, ID.TPO_P), [], "not approved yet");
  assert.deepEqual(await names(d, ID.SA), []);
  assert.deepEqual(await names(d, null), []);
  await d.exec("set role anon");
  try { await assert.rejects(d.query("select * from public.needs_review_submissions()"), /permission denied/); }
  finally { await d.exec("reset role"); }
});
