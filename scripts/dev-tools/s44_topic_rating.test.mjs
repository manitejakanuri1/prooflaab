// S44: migration 146 (per-topic rating, step one: record graded Lots, show strong / weak) executed on a real
// PostgreSQL engine. OFFLINE, IN-MEMORY, THROWAWAY. Same harness idea as s34_migration_105.test.mjs.
//
// PGlite is not a repository dependency: point PGLITE_MODULE at an install of @electric-sql/pglite. Without it every
// test here is SKIPPED, never passed.
//
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/s44_topic_rating.test.mjs
//
// The fixture holds only what 146 touches. Migration 55 (the rating table and record_topic_attempt) and 146 are
// applied exactly as written in the files. tag_skills() is a two-skill stand-in for the real vocabulary function.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const M55 = readFileSync(join(ROOT, "supabase/migrations/20260927000000_stage55_per_topic_rating.sql"), "utf8");
const M146 = readFileSync(join(ROOT, "migration/146-topic-rating-wiring.sql"), "utf8");
const R146 = readFileSync(join(ROOT, "migration/146-rollback-topic-rating-wiring.sql"), "utf8");

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped below */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const SA = "00000000-0000-4000-8000-0000000000a1";
const SB = "00000000-0000-4000-8000-0000000000a2";
const GHOST = "00000000-0000-4000-8000-0000000000ff"; // a student id with no profile row
const CAND = "00000000-0000-4000-8000-00000000c001";

const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create function public.is_admin() returns boolean language sql stable as $$ select false $$;
create table public.student_profiles (id uuid primary key references auth.users on delete cascade, full_name text);
create table public.levels (id uuid primary key default gen_random_uuid(), skill text);
create table public.lot_candidates (id uuid primary key, skills text[] not null default '{}');
create table public.tasks (id uuid primary key default gen_random_uuid(), student_id uuid, title text, description text,
  lot_date date, lot_candidate_id uuid, inserted_by uuid);
create table public.task_submissions (id uuid primary key default gen_random_uuid(), task_id uuid references public.tasks(id),
  student_id uuid, status text);
create function public.tag_skills(_text text) returns text[] language sql stable as $$
  select coalesce(array_agg(s order by s), '{}') from unnest(array['Python', 'SQL']) s where _text ilike '%' || s || '%' $$;

grant usage on schema public to anon, authenticated, service_role;
insert into auth.users values ('${SA}'), ('${SB}');
insert into public.student_profiles values ('${SA}', 'A'), ('${SB}', 'B');
insert into public.levels (skill) values ('Python'), ('SQL');
insert into public.lot_candidates values ('${CAND}', array['Python']);
`;

async function database({ wired = true } = {}) {
  const db = new PGlite();
  await db.exec(FIXTURE);
  await db.exec(M55);
  if (wired) await db.exec(M146);
  await db.exec(`grant select, insert, update, delete on all tables in schema public to service_role;`);
  return db;
}
async function as(db, role, userId, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId ?? "", role })}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
}
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0] ?? {})[0];
const quiz = (db, student, topic, outcome, n) =>
  db.exec(Array.from({ length: n }, () => `select public.record_topic_attempt('${student}', '${topic}', '${outcome}');`).join("\n"));
/** A Lot task for a student; returns its id. */
const lot = (db, student, { title = "Tidy a log", cand = null, lotDate = "2026-10-26", inserted = null } = {}) =>
  one(db, `insert into public.tasks (student_id, title, description, lot_date, lot_candidate_id, inserted_by)
           values ('${student}', '${title}', '', ${lotDate ? `'${lotDate}'` : "null"}, ${cand ? `'${cand}'` : "null"}, ${inserted ? `'${inserted}'` : "null"})
           returning id`);
const submit = (db, task, student, status) =>
  one(db, `insert into public.task_submissions (task_id, student_id, status) values ('${task}', '${student}', '${status}') returning id`);
const rating = (db, student, topic) =>
  db.query(`select rating, attempts from public.topic_ratings where student_id = '${student}' and topic = '${topic}'`).then((r) => r.rows[0]);

test("146 applies as written, its self-check passes, and it applies twice", { skip }, async () => {
  const db = await database();
  await db.exec(M146);
});

test("labels and accuracy from quiz attempts: new under 3, strong at 75%+, needs work under 50%", { skip }, async () => {
  const db = await database();
  await quiz(db, SA, "Python", "correct", 2);
  let rows = (await as(db, "authenticated", SA, `select * from public.my_topic_ratings()`)).rows;
  assert.equal(rows.find((r) => r.topic === "Python").label, "new", "2 attempts is not enough to judge");

  await quiz(db, SA, "Python", "correct", 2);
  await quiz(db, SA, "Python", "incorrect", 1);          // 4 of 5 = 80%
  await quiz(db, SA, "SQL", "incorrect", 3);              // 0 of 3
  await quiz(db, SA, "Git", "correct", 2); await quiz(db, SA, "Git", "incorrect", 2); // 2 of 4 = 50%
  rows = (await as(db, "authenticated", SA, `select * from public.my_topic_ratings()`)).rows;
  const by = Object.fromEntries(rows.map((r) => [r.topic, r]));
  assert.equal(by.Python.label, "strong"); assert.equal(by.Python.accuracy_pct, 80); assert.equal(by.Python.attempts, 5);
  assert.equal(by.SQL.label, "needs_work"); assert.equal(by.SQL.accuracy_pct, 0);
  assert.equal(by.Git.label, "building"); assert.equal(by.Git.accuracy_pct, 50);
  assert.deepEqual(rows.map((r) => r.topic), ["Python", "SQL", "Git"], "strong first, then needs work, then building");
  assert.equal(Object.hasOwn(rows[0], "rating"), false, "the raw rating is never returned");
});

test("a passed daily Lot counts as one correct attempt on its tagged skill, once", { skip }, async () => {
  const db = await database();
  const t = await lot(db, SA, { cand: CAND });
  await submit(db, t, SA, "passed");
  assert.deepEqual(await rating(db, SA, "Python"), { rating: 1225, attempts: 1 });
  // a second submission is a second attempt; the same submission never counts twice
  const s2 = await submit(db, t, SA, "failed");
  assert.deepEqual(await rating(db, SA, "Python"), { rating: 1217, attempts: 2 });
  await db.exec(`update public.task_submissions set status = 'failed' where id = '${s2}'`);
  await db.exec(`update public.task_submissions set status = 'passed' where id = '${s2}'`);
  assert.equal((await rating(db, SA, "Python")).attempts, 2, "a status change on a counted submission is not recounted");
});

test("needs_review waits for a person, then counts once", { skip }, async () => {
  const db = await database();
  const t = await lot(db, SA, { cand: CAND });
  const s = await submit(db, t, SA, "needs_review");
  assert.equal(await rating(db, SA, "Python"), undefined, "nothing is counted while it is under review");
  await db.exec(`update public.task_submissions set status = 'passed' where id = '${s}'`);
  assert.equal((await rating(db, SA, "Python")).attempts, 1);
  await db.exec(`update public.task_submissions set status = 'passed' where id = '${s}'`);
  assert.equal((await rating(db, SA, "Python")).attempts, 1, "no change, no recount");
});

test("a Lot with no candidate is tagged from its own text; untagged, non-daily and self-made tasks are ignored", { skip }, async () => {
  const db = await database();
  await submit(db, await lot(db, SA, { title: "Write a SQL query for failed logins" }), SA, "passed");
  assert.equal((await rating(db, SA, "SQL")).attempts, 1, "tagged from the task text");
  await submit(db, await lot(db, SA, { title: "Plan the trip" }), SA, "passed");
  await submit(db, await lot(db, SA, { cand: CAND, lotDate: null }), SA, "passed");
  await submit(db, await lot(db, SA, { cand: CAND, inserted: SA }), SA, "passed");
  assert.equal(await rating(db, SA, "Python"), undefined, "not a daily Lot, or made by the student, or untagged: no rating");
  assert.equal(await one(db, `select count(*)::int from public.topic_ratings where student_id = '${SA}'`), 1);
});

test("a rating problem never fails the student's submission", { skip }, async () => {
  const db = await database();
  // a student with no profile row: the dedupe log's foreign key refuses, the trigger must swallow it
  const t = await lot(db, GHOST, { cand: CAND });
  const id = await submit(db, t, GHOST, "passed");
  assert.ok(id, "the submission was saved");
  assert.equal(await one(db, `select count(*)::int from public.task_submissions where id = '${id}'`), 1);
});

test("students see only their own topics, cannot record, and cannot read other students' priorities", { skip }, async () => {
  const db = await database();
  await quiz(db, SA, "Python", "correct", 3);
  await quiz(db, SB, "SQL", "correct", 3);
  const a = (await as(db, "authenticated", SA, `select * from public.my_topic_ratings()`)).rows.map((r) => r.topic);
  assert.deepEqual(a, ["Python"], "B's SQL is not visible to A");
  await assert.rejects(as(db, "authenticated", SA, `select public.record_lot_topic_rating(gen_random_uuid())`), /permission denied/);
  await assert.rejects(as(db, "authenticated", SA, `select public.record_topic_attempt('${SA}', 'Python', 'correct')`), /permission denied/);
  await assert.rejects(as(db, "authenticated", SA, `select * from public.topic_priorities('${SB}', 5)`), /permission denied/, "was open to every signed-in student before 146");
  await assert.rejects(as(db, "authenticated", SA, `select * from public.topic_rating_log`), /permission denied/);
  assert.equal((await as(db, "service_role", null, `select count(*)::int as n from public.topic_priorities('${SB}', 5)`)).rows[0].n > 0, true, "the server can still use it");
});

test("the rollback removes the trigger and the student read, hands topic_priorities back, and 146 re-applies", { skip }, async () => {
  const db = await database();
  await db.exec(R146);
  assert.equal(await one(db, `select count(*)::int from pg_trigger where tgname = 'task_submissions_topic_rating'`), 0);
  assert.equal(await one(db, `select count(*)::int from pg_proc where proname = 'my_topic_ratings'`), 0);
  assert.equal(await one(db, `select has_function_privilege('authenticated', 'public.topic_priorities(uuid,integer)', 'execute')`), true);
  const t = await lot(db, SA, { cand: CAND });
  await submit(db, t, SA, "passed");
  assert.equal(await rating(db, SA, "Python"), undefined, "no recording after rollback");
  await db.exec(M146);
  await submit(db, t, SA, "passed");
  assert.equal((await rating(db, SA, "Python")).attempts, 1, "recording resumes after re-apply");
});
