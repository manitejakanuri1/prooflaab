// Migration 147 (the question bank) executed on a real PostgreSQL engine. OFFLINE, IN-MEMORY, THROWAWAY.
// PGlite is not a repository dependency: point PGLITE_MODULE at an install of @electric-sql/pglite. Without it every
// test here is SKIPPED, never passed.
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/s44_question_bank.test.mjs
//
// The fixture holds only what 147 touches: roles, auth.uid(), is_admin(), source_content, and the REAL skill_vocab and
// tag_skills() cut from migration 88. Each scenario runs as a real role (SET ROLE) with real claims.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = read("migration/147-question-bank.sql");
const ROLLBACK = read("migration/147-rollback-question-bank.sql");
const M88 = read("supabase/migrations/20261103003800_daily_lots_v2_evidence_selection.sql");
const VOCAB = M88.slice(M88.indexOf("create table if not exists public.skill_vocab"),
  M88.indexOf("$function$;", M88.indexOf("create or replace function public.tag_skills")) + "$function$;".length);

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped below */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const ADM = "00000000-0000-4000-8000-0000000000e1";
const STU = "00000000-0000-4000-8000-0000000000a1";
const P1 = "00000000-0000-4000-8000-00000000b001"; // a normal page
const P2 = "00000000-0000-4000-8000-00000000b002"; // hidden page
const P3 = "00000000-0000-4000-8000-00000000b003"; // too short
const P4 = "00000000-0000-4000-8000-00000000b004"; // second normal page, older
const NOPE = "00000000-0000-4000-8000-0000000000ff";
const LONG = "x".repeat(400);

const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table public.user_roles (user_id uuid primary key references auth.users on delete cascade, role text not null);
create function public.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role = 'admin') $$;
create table public.source_content (id uuid primary key, title text, url text, markdown text,
  fetched_at timestamptz not null default now(), hidden_at timestamptz);
${VOCAB}
insert into auth.users values ('${ADM}'), ('${STU}');
insert into public.user_roles values ('${ADM}', 'admin'), ('${STU}', 'student');
insert into public.source_content (id, title, url, markdown, fetched_at, hidden_at) values
  ('${P1}', 'SQL interview questions', 'https://example.com/sql', '${LONG}', now() - interval '1 hour', null),
  ('${P2}', 'Hidden page', 'https://example.com/hidden', '${LONG}', now(), now()),
  ('${P3}', 'Short page', 'https://example.com/short', 'too short', now(), null),
  ('${P4}', 'Older page', 'https://example.com/older', '${LONG}', now() - interval '2 days', null);
`;

async function database() {
  const db = new PGlite();
  await db.exec(FIXTURE);
  await db.exec(MIGRATION);
  return db;
}
async function as(db, role, user, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: user ?? "" })}', false);`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const items = (list) => `'${JSON.stringify(list).replace(/'/g, "''")}'::jsonb`;
const q = (question, extra = {}) => ({ question, kind: "written", difficulty: "medium", answer_notes: "Key points.", ...extra });

test("147 applies with its own self-check, is mirrored identically, and does not touch Lot picking", { skip }, async () => {
  await database();
  assert.equal(MIGRATION, read("supabase/migrations/20261103013700_question_bank.sql"));
  assert.ok(!/next_lot_pick|create_lot_for|lot_templates/.test(MIGRATION.replace(/--.*$/gm, "")));
});

test("students and anonymous callers cannot read or write the bank; the service role can", { skip }, async () => {
  const db = await database();
  await db.exec(`select public.question_bank_add('${P1}', ${items([q("Explain the difference between INNER JOIN and LEFT JOIN in SQL.")])}, '{}'::jsonb)`);
  for (const [role, user] of [["authenticated", STU], ["anon", null]]) {
    await assert.rejects(as(db, role, user, "select * from public.question_bank"), /permission denied/);
    await assert.rejects(as(db, role, user, "select * from public.question_bank_attempts"), /permission denied/);
    await assert.rejects(as(db, role, user, `insert into public.question_bank (source_content_id, question, kind) values ('${P1}', 'A long enough question here', 'written')`), /permission denied/);
    await assert.rejects(as(db, role, user, "select * from public.question_bank_pending(3)"), /permission denied/);
    await assert.rejects(as(db, role, user, `select public.question_bank_add('${P1}', '[]'::jsonb)`), /permission denied/);
  }
  assert.equal((await as(db, "service_role", null, "select count(*)::int as n from public.question_bank")).rows[0].n, 1);
});

test("the skill comes from the fixed vocabulary, never from the caller", { skip }, async () => {
  const db = await database();
  await db.exec(`select public.question_bank_add('${P1}', ${items([
    q("Write a SQL query that uses a JOIN to list each order with its customer.", { skill: "Kubernetes" }),
    q("Describe a time you resolved a disagreement with a teammate."),
  ])}, '{}'::jsonb)`);
  const sql = (await db.query(`select skill, skills from public.question_bank where question like 'Write a SQL%'`)).rows[0];
  assert.equal(sql.skill, "SQL", "a SQL question is tagged SQL, not what the caller claimed");
  assert.ok(sql.skills.includes("SQL"));
  const soft = (await db.query(`select skill, skills from public.question_bank where question like 'Describe a time%'`)).rows[0];
  assert.equal(soft.skill, null, "no vocabulary match keeps skill null");
  await assert.rejects(as(db, "service_role", null, "update public.question_bank set skill = 'Not A Skill'"), /foreign key|violates/i);
});

test("the same question is stored once however it is spaced or capitalised; bad rows are skipped, good ones kept", { skip }, async () => {
  const db = await database();
  const first = (await db.query(`select public.question_bank_add('${P1}', ${items([q("Explain how a hash map handles collisions.")])}, '{}'::jsonb) as r`)).rows[0].r;
  assert.deepEqual(first, { stored: 1, skipped: 0 });
  const second = (await db.query(`select public.question_bank_add('${P1}', ${items([
    q("  EXPLAIN how a hash map handles collisions.  "),
    q("Too short"),
    q("A well formed question about queues and stacks?", { kind: "quiz" }),
    q("A well formed question about recursion and its base case?", { difficulty: "insane" }),
    q("What does the Linux command grep do when given a pattern?"),
  ])}, '{}'::jsonb) as r`)).rows[0].r;
  assert.deepEqual(second, { stored: 1, skipped: 4 });
  assert.equal(await one(db, "select count(*)::int from public.question_bank"), 2);
  await assert.rejects(db.query(`select public.question_bank_add('${P1}', '{"not":"an array"}'::jsonb)`), /array/);
  await assert.rejects(db.query(`select public.question_bank_add('${NOPE}', '[]'::jsonb)`), /unknown source_content_id/);
});

test("pending pages: visible, long enough, not yet tried; a page tried with nothing stored is not retried", { skip }, async () => {
  const db = await database();
  const pending = async () => (await as(db, "service_role", null, "select id from public.question_bank_pending(10)")).rows.map((r) => r.id);
  assert.deepEqual(await pending(), [P1, P4], "newest first; hidden and short pages never");
  await db.exec(`select public.question_bank_add('${P1}', '[]'::jsonb, '{}'::jsonb)`);
  assert.deepEqual(await pending(), [P4], "an attempt with 0 stored still counts as tried");
  assert.equal(await one(db, `select stored::int from public.question_bank_attempts where source_content_id = '${P1}'`), 0);
  assert.equal((await as(db, "service_role", null, "select id from public.question_bank_pending(1)")).rows.length, 1, "limit is honoured");
});

test("admin list and review: admin only, counts, status change, paging, unknown ids and statuses refused", { skip }, async () => {
  const db = await database();
  await db.exec(`select public.question_bank_add('${P1}', ${items([
    q("Explain the difference between INNER JOIN and LEFT JOIN in SQL."),
    q("Describe how you would structure a git branching strategy."),
  ])}, '{"model":"test"}'::jsonb)`);
  const id = await one(db, "select id from public.question_bank where question like 'Explain%'");

  await assert.rejects(as(db, "authenticated", STU, "select public.admin_question_bank()"), /admins only/);
  await assert.rejects(as(db, "authenticated", STU, `select public.admin_set_question_status('${id}', 'approved')`), /admins only/);
  await assert.rejects(as(db, "anon", null, "select public.admin_question_bank()"), /permission denied/);

  const list = (await as(db, "authenticated", ADM, "select public.admin_question_bank() as r")).rows[0].r;
  assert.deepEqual(list.counts, { draft: 2, approved: 0, hidden: 0, untagged: 0 });
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].page_title, "SQL interview questions");

  await as(db, "authenticated", ADM, `select public.admin_set_question_status('${id}', 'approved')`);
  const row = (await db.query(`select status, reviewed_at is not null as stamped, reviewed_by from public.question_bank where id = '${id}'`)).rows[0];
  assert.equal(row.status, "approved"); assert.ok(row.stamped); assert.equal(row.reviewed_by, ADM);
  const after = (await as(db, "authenticated", ADM, "select public.admin_question_bank('approved') as r")).rows[0].r;
  assert.equal(after.items.length, 1); assert.equal(after.counts.approved, 1); assert.equal(after.counts.draft, 1);

  await as(db, "authenticated", ADM, `select public.admin_set_question_status('${id}', 'draft')`);
  assert.equal(await one(db, `select reviewed_at is null from public.question_bank where id = '${id}'`), true, "back to draft clears the review stamp");
  await assert.rejects(as(db, "authenticated", ADM, `select public.admin_set_question_status('${id}', 'deleted')`), /status must be/);
  await assert.rejects(as(db, "authenticated", ADM, `select public.admin_set_question_status('${NOPE}', 'hidden')`), /question not found/);

  const oldest = await one(db, "select min(created_at)::text from public.question_bank");
  const paged = (await as(db, "authenticated", ADM, `select public.admin_question_bank('draft', 50, '${oldest}'::timestamptz) as r`)).rows[0].r;
  assert.equal(paged.items.length, 0, "_after pages by created_at: nothing older than the oldest");
});

test("deleting a page removes its questions and attempt; rollback removes everything and can be re-applied", { skip }, async () => {
  const db = await database();
  await db.exec(`select public.question_bank_add('${P1}', ${items([q("Explain the difference between a process and a thread.")])}, '{}'::jsonb)`);
  await db.exec(`delete from public.source_content where id = '${P1}'`);
  assert.equal(await one(db, "select count(*)::int from public.question_bank"), 0);
  assert.equal(await one(db, "select count(*)::int from public.question_bank_attempts"), 0);
  await db.exec(ROLLBACK);
  assert.equal(await one(db, "select to_regclass('public.question_bank') is null"), true);
  assert.equal(await one(db, "select count(*)::int from pg_proc where proname in ('question_bank_add','question_bank_pending','admin_question_bank','admin_set_question_status','question_bank_tag')"), 0);
  await db.exec(MIGRATION);
  assert.equal(await one(db, "select count(*)::int from public.question_bank"), 0);
});
