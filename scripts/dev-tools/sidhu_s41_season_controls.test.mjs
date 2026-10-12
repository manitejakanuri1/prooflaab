// S41: College -> Squads "Run this week" (tpo_run_week, stage 16) and "Schedule matches" (tpo_generate_fixtures,
// stage 50) had no test. OFFLINE on PostgreSQL 16 (PGlite) with the DEPLOYED bodies. The league engines behind them
// (run_squad_week, generate_cohort_league) are replaced by recorders: the question here is which season a college
// can act on. Rebuilding over played matches is a deliberate, confirmed action (the server refuses first and the
// screen offers "Rebuild anyway"), so it is not tested as a fault.
//   PGLITE_MODULE=file:///.../pglite/dist/index.js node --test scripts/dev-tools/sidhu_s41_season_controls.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { read } from "./sidhu_s39_squad_fixture.mjs";

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const cut = (file, start, end) => { const t = read(file).replace(/\r\n/g, "\n"); const a = t.indexOf(start); const b = t.indexOf(end, a); if (a < 0 || b < 0) throw new Error(`${start} not in ${file}`); return t.slice(a, b + end.length); };
const DEPLOYED = [
  cut("supabase/migrations/20260821070000_stage16_squad_scoring_functions.sql", "create or replace function public.tpo_run_week(", "end $fn$;"),
  cut("supabase/migrations/20260922000000_stage50_league_qualification_championship.sql", "create or replace function public.tpo_generate_fixtures(", "end $function$;"),
].join("\n");

const ID = { TPO_A: "00000000-0000-4000-8000-00000000a0a1", TPO_B: "00000000-0000-4000-8000-00000000a0b1", A: "00000000-0000-4000-8000-00000000c0a1",
  B: "00000000-0000-4000-8000-00000000c0b1", SA: "00000000-0000-4000-8000-0000000005a1", SA_OLD: "00000000-0000-4000-8000-0000000005a0",
  SB: "00000000-0000-4000-8000-0000000005b1", STU: "00000000-0000-4000-8000-0000000000aa" };
const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $f$;
grant usage on schema auth, public to anon, authenticated, service_role;
create table public.college_admins (user_id uuid primary key, college_id uuid);
create function public.my_college_id() returns uuid language sql stable security definer set search_path = public, pg_temp as
  $f$ select college_id from public.college_admins where user_id = auth.uid() $f$;
create function public.is_admin() returns boolean language sql stable as $f$ select false $f$;
create table public.seasons (id uuid primary key, college_id uuid, is_current boolean, starts_on date);
create table public.engine_calls (fn text, season uuid, arg text);
create function public.run_squad_week(_s uuid, _w integer default null) returns jsonb language sql security definer set search_path = public, pg_temp as
  $f$ insert into public.engine_calls values ('run_squad_week', _s, coalesce(_w::text, 'current')); select '{"ok":true}'::jsonb $f$;
create function public.generate_cohort_league(_s uuid, _force boolean default false) returns jsonb language sql security definer set search_path = public, pg_temp as
  $f$ insert into public.engine_calls values ('generate_cohort_league', _s, _force::text); select '{"fixtures":0}'::jsonb $f$;
${DEPLOYED}
revoke all on function public.run_squad_week(uuid, integer) from public, anon, authenticated;
revoke all on function public.generate_cohort_league(uuid, boolean) from public, anon, authenticated;
insert into public.college_admins values ('${ID.TPO_A}', '${ID.A}'), ('${ID.TPO_B}', '${ID.B}');
insert into public.seasons values ('${ID.SA}', '${ID.A}', true, '2026-10-01'), ('${ID.SA_OLD}', '${ID.A}', false, '2026-07-01'), ('${ID.SB}', '${ID.B}', true, '2026-10-01');`;

async function db() { const d = new PGlite(); await d.exec(FIXTURE); return d; }
async function as(d, sub, sql) {
  await d.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: sub ?? "" })}', false);`);
  try { return await d.query(sql); } finally { await d.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}
const calls = async (d) => (await d.query(`select fn, season::text, arg from public.engine_calls`)).rows;

test("run the week / schedule matches: always the caller college's CURRENT season, never an old or another college's", { skip }, async () => {
  const d = await db();
  await as(d, ID.TPO_A, "select public.tpo_run_week(3)");
  await as(d, ID.TPO_A, "select public.tpo_generate_fixtures()");
  await as(d, ID.TPO_B, "select public.tpo_generate_fixtures(true)");
  assert.deepEqual(await calls(d), [
    { fn: "run_squad_week", season: ID.SA, arg: "3" },
    { fn: "generate_cohort_league", season: ID.SA, arg: "false" },
    { fn: "generate_cohort_league", season: ID.SB, arg: "true" },
  ]);
});

test("a student, a signed-out caller and a college with no running season are refused; the engines are not browser-callable", { skip }, async () => {
  const d = await db();
  for (const who of [ID.STU, null]) {
    await assert.rejects(as(d, who, "select public.tpo_run_week()"), /only a college/);
    await assert.rejects(as(d, who, "select public.tpo_generate_fixtures()"), /only a college/);
  }
  await d.exec(`update public.seasons set is_current = false where college_id = '${ID.B}'`);
  await assert.rejects(as(d, ID.TPO_B, "select public.tpo_run_week()"), /no season is running/);
  await assert.rejects(as(d, ID.TPO_B, "select public.tpo_generate_fixtures()"), /no season is running/);
  await assert.rejects(as(d, ID.TPO_A, `select public.run_squad_week('${ID.SB}', 1)`), /permission denied/);
  await assert.rejects(as(d, ID.TPO_A, `select public.generate_cohort_league('${ID.SB}', true)`), /permission denied/);
  assert.deepEqual(await calls(d), []);
});
