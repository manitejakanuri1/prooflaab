// S41: the college's squad management RPCs that had no test anywhere. OFFLINE on PostgreSQL 16 (PGlite), with the
// DEPLOYED function bodies cut from their migrations. Covers behaviour, database effects and college isolation.
//   PGLITE_MODULE=file:///.../pglite/dist/index.js node --test scripts/dev-tools/sidhu_s41_squad_management.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { ID, FIXTURE, M108, read, students, squad, active } from "./sidhu_s39_squad_fixture.mjs";

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const cut = (file, start, end) => { const t = read(file); const a = t.indexOf(start); const b = t.indexOf(end, a); if (a < 0 || b < 0) throw new Error(`${start} not in ${file}`); return t.slice(a, b + end.length); };
const EMPTY = read("migration/25-empty-squads.sql");
const DEPLOYED = [
  cut("migration/25-empty-squads.sql", "create or replace function public.tpo_empty_squads()", "$function$;"),
  cut("migration/25-empty-squads.sql", "create or replace function public.tpo_delete_empty_squads()", "end $function$;"),
  cut("supabase/migrations/20260926000000_stage54_squads_of_eleven_college_places_the_rest.sql", "create or replace function public.tpo_create_squad(", "end $function$;"),
].join("\n");
const M112 = (() => { try { return read("migration/112-empty-squads-keep-history.sql"); } catch { return ""; } })();
void EMPTY;

// What hangs off a squad, with the deployed foreign keys (stage 7, 16, 15, 23).
const HISTORY = `
create table public.squad_matches (id uuid primary key default gen_random_uuid(), season_id uuid,
  home_squad uuid not null references public.squads(id) on delete cascade,
  away_squad uuid not null references public.squads(id) on delete cascade, home_points int, away_points int);
create table public.squad_weekly_scores (season_id uuid, squad_id uuid not null references public.squads(id) on delete cascade, week int, points int);
create table public.student_weekly_scores (student_id uuid, squad_id uuid references public.squads(id) on delete set null, week int, points int);
alter table public.seasons add column champion_squad_id uuid references public.squads(id) on delete set null,
  add column runner_up_squad_id uuid references public.squads(id) on delete set null,
  add column third_squad_id uuid references public.squads(id) on delete set null;
grant execute on function public.write_audit(text, text, uuid, jsonb, jsonb, uuid) to authenticated;`;

async function database({ fixed = true } = {}) {
  const db = new PGlite();
  await db.exec(FIXTURE); await db.exec(M108); await db.exec(HISTORY); await db.exec(DEPLOYED);
  if (fixed && M112) await db.exec(M112);
  return db;
}
async function as(db, user, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: user ?? "" })}', false);`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const seed = async (db, ...p) => { for (const x of p) if (x.sql) await db.exec(x.sql); };

/** A finished season: squad A (all its students since removed) beat B, won the season. */
async function historyWorld(db) {
  const a = squad(ID.A, ID.SA, "CSE-A", []); const b = squad(ID.A, ID.SA, "CSE-A", students(ID.A, "CSE-A", 0).ids);
  const bMembers = students(ID.A, "CSE-A", 3); const fresh = squad(ID.A, ID.SA, "ECE-A", []);
  await seed(db, a, b, bMembers, fresh);
  await db.exec(`insert into public.squad_members (squad_id, student_id) select '${b.id}', unnest(array[${bMembers.ids.map((i) => `'${i}'`).join(",")}]::uuid[]);
    insert into public.squad_matches (season_id, home_squad, away_squad, home_points, away_points) values ('${ID.SA}', '${a.id}', '${b.id}', 300, 120);
    insert into public.squad_weekly_scores values ('${ID.SA}', '${a.id}', 1, 300), ('${ID.SA}', '${b.id}', 1, 120);
    update public.seasons set champion_squad_id = '${a.id}', runner_up_squad_id = '${b.id}' where id = '${ID.SA}';`);
  return { a, b, fresh };
}

test("BUG (deployed): removing 'empty' squads erases a champion's history and the opponent's match record", { skip }, async () => {
  const db = await database({ fixed: false });
  const { a, b } = await historyWorld(db);
  assert.equal(await one(db, `select count(*)::int from public.squad_matches`), 1);
  const removed = (await as(db, ID.TPO_A, "select public.tpo_delete_empty_squads() as n")).rows[0].n;
  assert.equal(removed, 2, "the champion squad A and the never-used ECE squad were both deleted");
  assert.equal(await one(db, `select count(*)::int from public.squad_matches where away_squad = '${b.id}'`), 0, "B lost the match it played");
  assert.equal(await one(db, `select champion_squad_id::text from public.seasons where id = '${ID.SA}'`), null, "the season lost its champion");
  assert.equal(await one(db, `select count(*)::int from public.squad_weekly_scores where squad_id = '${a.id}'`), 0, "and A's weekly scores");
});

test("FIXED (112): only never-used squads are removed; history, matches, scores and the podium stay", { skip: skip || (!M112 && "migration 112 not written yet") }, async () => {
  const db = await database();
  const { a, b, fresh } = await historyWorld(db);
  assert.equal((await as(db, ID.TPO_A, "select public.tpo_empty_squads() as n")).rows[0].n, 1, "the prompt counts what will really go");
  assert.equal((await as(db, ID.TPO_A, "select public.tpo_delete_empty_squads() as n")).rows[0].n, 1);
  assert.equal(await one(db, `select count(*)::int from public.squads where id = '${fresh.id}'`), 0, "the never-used squad is gone");
  assert.equal(await one(db, `select count(*)::int from public.squads where id = '${a.id}'`), 1, "the champion squad stays");
  assert.equal(await one(db, `select count(*)::int from public.squad_matches where away_squad = '${b.id}'`), 1);
  assert.equal(await one(db, `select champion_squad_id::text from public.seasons where id = '${ID.SA}'`), a.id);
  assert.equal(await one(db, `select count(*)::int from public.squad_weekly_scores`), 2);
  assert.equal((await as(db, ID.TPO_A, "select public.tpo_delete_empty_squads() as n")).rows[0].n, 0, "a second press removes nothing");
});

test("FIXED (112): a squad a student has ever been in (left since) is kept", { skip: skip || (!M112 && "migration 112 not written yet") }, async () => {
  const db = await database();
  const m = students(ID.A, "CSE-A", 1); const s = squad(ID.A, ID.SA, "CSE-A", m.ids);
  await seed(db, m, s);
  await db.exec(`update public.squad_members set left_at = now() where squad_id = '${s.id}'`);
  assert.equal((await as(db, ID.TPO_A, "select public.tpo_delete_empty_squads() as n")).rows[0].n, 0);
  assert.equal(await one(db, active(s.id)), 0);
  assert.equal(await one(db, `select count(*)::int from public.squad_members where squad_id = '${s.id}'`), 1, "the membership history is kept");
});

test("FIXED (112): a squad that only has students' weekly scores (its members since removed) is kept and stays linked", { skip: skip || (!M112 && "migration 112 not written yet") }, async () => {
  const db = await database();
  const s = squad(ID.A, ID.SA, "CSE-A", []);
  await seed(db, s);
  await db.exec(`insert into public.student_weekly_scores values (null, '${s.id}', 1, 40)`);
  assert.equal((await as(db, ID.TPO_A, "select public.tpo_delete_empty_squads() as n")).rows[0].n, 0);
  assert.equal(await one(db, `select squad_id::text from public.student_weekly_scores`), s.id);
});

test("FIXED (112): a signed-out caller can no longer even run the functions (live grants had PUBLIC and anon)", { skip: skip || (!M112 && "migration 112 not written yet") }, async () => {
  const db = await database();
  await db.exec(`grant execute on function public.tpo_delete_empty_squads() to public, anon; grant execute on function public.tpo_empty_squads() to public, anon;`);
  await db.exec(M112);
  assert.equal(await one(db, `select has_function_privilege('anon', 'public.tpo_delete_empty_squads()', 'execute')`), false);
  assert.equal(await one(db, `select has_function_privilege('anon', 'public.tpo_empty_squads()', 'execute')`), false);
  assert.equal(await one(db, `select has_function_privilege('authenticated', 'public.tpo_delete_empty_squads()', 'execute')`), true);
});

test("delete empty squads: only the caller's college; students and anonymous callers refused", { skip }, async () => {
  const db = await database();
  const mine = squad(ID.A, ID.SA, "CSE-A", []); const theirs = squad(ID.B, ID.SB, "CSE-A", []);
  await seed(db, mine, theirs);
  assert.equal((await as(db, ID.TPO_B, "select public.tpo_delete_empty_squads() as n")).rows[0].n, 1);
  assert.equal(await one(db, `select count(*)::int from public.squads where id = '${mine.id}'`), 1, "college B cannot remove college A's squad");
  await assert.rejects(as(db, null, "select public.tpo_delete_empty_squads()"), /only a college/);
  await assert.rejects(as(db, "00000000-0000-4000-8000-0000000000ff", "select public.tpo_delete_empty_squads()"), /only a college/);
});

test("create squad: own college and season, twelve seats, unique name per season, audited; refused without a college", { skip }, async () => {
  const db = await database();
  const out = (await as(db, ID.TPO_A, "select public.tpo_create_squad('Night Owls', 'CIVIL-A') as r")).rows[0].r;
  assert.equal(out.max_members, 12);
  assert.deepEqual((await db.query(`select college_id::text, season_id::text, cohort from public.squads where id = '${out.squad_id}'`)).rows[0],
    { college_id: ID.A, season_id: ID.SA, cohort: "CIVIL-A" });
  await assert.rejects(as(db, ID.TPO_A, "select public.tpo_create_squad('night owls')"), /already a squad called/);
  await assert.rejects(as(db, ID.TPO_A, "select public.tpo_create_squad('   ')"), /needs a name/);
  await assert.rejects(as(db, null, "select public.tpo_create_squad('X')"), /only a college/);
  assert.equal(await one(db, `select count(*)::int from public.audit_log where action = 'SQUAD_CREATED'`), 1);
  // The nightly fill uses it like any other squad of that section.
  await seed(db, students(ID.A, "CIVIL-A", 4));
  await as(db, ID.TPO_A, "select public.tpo_form_squads()");
  assert.equal(await one(db, active(out.squad_id)), 4);
});
