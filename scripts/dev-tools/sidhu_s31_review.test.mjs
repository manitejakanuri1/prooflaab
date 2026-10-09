// S31 regression tests for migration 104 on a REAL PostgreSQL engine (PGlite, in-memory, throwaway; see
// sidhu_s30_pg_harness.mjs). Offline simulation only - not a live database.
//
//   PGLITE_MODULE=<file URL of @electric-sql/pglite/dist/index.js> node --test scripts/dev-tools/sidhu_s31_review.test.mjs
//
// State: the S30 AFTER state (repository migrations + 91 + 103, record_task_submission byte-identical to live staging),
// plus migration 86's review_task_submission verbatim (BEFORE 104) and migration 40's notifications dedupe index;
// then migration/104 applied exactly as written.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeDb, as, peek, ID } from "./sidhu_s30_pg_harness.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const M104 = read("migration/104-ai-first-review-and-safe-resolution.sql");
const R104 = read("migration/104-rollback-ai-first-review-and-safe-resolution.sql");
const m86 = read("migration/86-close-remaining-db-findings.sql");
const REVIEW_86 = m86.slice(m86.indexOf("create or replace function public.review_task_submission("), m86.indexOf("end $function$;", m86.indexOf("create or replace function public.review_task_submission(")) + 15);
const SIG = "public.review_task_submission(uuid, boolean)";

const EXTRA = `
alter table public.task_rubric_config add column if not exists prompt_text text, add column if not exists reference_answer text;
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, actor_id uuid, post_id uuid,
  audience text not null default 'student', source text not null default 'system', type text not null, title text not null,
  message text not null, link text, metadata jsonb, is_read boolean not null default false, read_at timestamptz,
  created_at timestamptz not null default now(), dedupe_key text);
${read("migration/40-notify-weekly-progress-idempotent.sql").match(/create unique index if not exists notifications_user_type_dedupe_key_uniq[\s\S]*?;/)[0]}
grant all on public.notifications to anon, authenticated, service_role;
${REVIEW_86}
revoke all on function ${SIG} from public, anon;
grant execute on function ${SIG} to authenticated, service_role;
`;

const log = [];
let available = true, pg_trgm;
const build = async ({ with104 }) => {
  const { db } = await makeDb({ fixed: true, extensions: { pg_trgm } });
  await db.exec(EXTRA);
  if (with104) await db.exec(M104);
  return db;
};
before(async () => {
  try { ({ pg_trgm } = await import(process.env.PGLITE_MODULE.replace(/index\.js$/, "contrib/pg_trgm.js"))); }
  catch { available = false; }
});
const need = (t) => { if (!available) t.skip("PGlite / pg_trgm not installed (set PGLITE_MODULE)"); return available; };
const run = async (db, state, who, sql, name) => { const r = await as(db, who, sql); log.push({ state, name, who, ok: r.ok, error: r.error, rows: r.rows }); return r; };

const Q = "00000000-0000-4000-8000-00000000a0a1";   // a question shared by SA and SB (same checklist, same text)
const LONG = "A hash map stores key value pairs in buckets chosen by hashing the key so lookups are average constant time. "
  + "Collisions are handled by chaining or open addressing and the table is resized when the load factor grows too high "
  + "which keeps operations fast while memory use stays reasonable for most real workloads in practice today.";
async function seedQuestions(db) {
  await peek(db, `insert into public.tasks (id, student_id, title, description, rubric_config_id, created_by_type, source) values
    ('${Q}', '${ID.SB}', 'Explain hash maps', 'How does a hash map give fast lookups?', '${ID.R1}', 'system', 'daily_lot'),
    ('00000000-0000-4000-8000-00000000a0a2', '${ID.SA}', 'Explain hash maps', 'How does a hash map give fast lookups?', '${ID.R1}', 'system', 'daily_lot'),
    ('00000000-0000-4000-8000-00000000a0a3', '${ID.SC}', 'Explain trees', 'How does a balanced tree stay fast?', '${ID.R1}', 'system', 'daily_lot')`);
  await peek(db, `update public.task_rubric_config set prompt_text = 'Explain the data structure clearly.', reference_answer = 'It uses hashing.' where id = '${ID.R1}'`);
  await peek(db, `insert into public.task_submissions (task_id, student_id, rubric_config_id, code, status, sandbox_score) values
    ('${Q}', '${ID.SB}', '${ID.R1}', '${LONG}', 'passed', 80)`);
}
const sim = (db, task, student, answer) => run(db, "AFTER", "SERVICE", `select public.similar_written_answer('${task}'::uuid, '${student}'::uuid, $q$${answer}$q$) as r`, "similar_written_answer");

test("similarity is measured against the SAME question only, with prompt overlap and length", async (t) => {
  if (!need(t)) return;
  const db = await build({ with104: true });
  await seedQuestions(db);
  const copy = (await sim(db, "00000000-0000-4000-8000-00000000a0a2", ID.SA, LONG)).rows[0].r;
  assert.ok(copy.score > 0.95, `same question, same words: ${copy.score}`);
  assert.ok(copy.prompt_overlap < 0.6, `not a restatement of the prompt: ${copy.prompt_overlap}`);
  assert.ok(copy.answer_words >= 40);
  const otherQuestion = (await sim(db, "00000000-0000-4000-8000-00000000a0a3", ID.SC, LONG)).rows[0].r;
  assert.equal(otherQuestion.score, 0, "same checklist but a different question is never compared");
  const own = (await sim(db, Q, ID.SB, LONG)).rows[0].r;
  assert.equal(own.score, 0, "a student's own earlier answer is not a copy");
  const restate = (await sim(db, "00000000-0000-4000-8000-00000000a0a2", ID.SA, "How does a hash map give fast lookups? Explain hash maps. It uses hashing.")).rows[0].r;
  assert.ok(restate.prompt_overlap >= 0.6, `restating the question is measured as prompt overlap: ${restate.prompt_overlap}`);
});

test("server-only functions are not callable by browser roles", async (t) => {
  if (!need(t)) return;
  const db = await build({ with104: true });
  for (const who of ["SA", "TPO1", "ANON"]) {
    assert.match((await run(db, "AFTER", who, `select public.similar_written_answer('${Q}'::uuid, '${ID.SA}'::uuid, 'x')`, "browser calls similarity")).error ?? "", /permission denied/);
    assert.match((await run(db, "AFTER", who, `select public.notify_pending_reviews()`, "browser calls digest")).error ?? "", /permission denied/);
  }
});

async function pendingFor(db, task, student, code = "my answer") {
  return (await peek(db, `insert into public.task_submissions (task_id, student_id, rubric_config_id, code, status, sandbox_score, flags)
    values ('${task}', '${student}', '${ID.R1}', '${code}', 'needs_review', 75, '{copied_answer}') returning id`))[0].id;
}
const review = (id, approve) => `select public.review_task_submission('${id}'::uuid, ${approve}) as r`;

test("approve resolves exactly once: task completed, XP once, one outcome notification", async (t) => {
  if (!need(t)) return;
  const db = await build({ with104: true });
  await peek(db, `update public.tasks set xp_reward = 20 where id = '${ID.DAILY}'`);
  const sub = await pendingFor(db, ID.DAILY, ID.SA);
  const first = (await run(db, "AFTER", "ADM", review(sub, true), "admin approves")).rows[0].r;
  assert.equal(first.status, "passed"); assert.equal(first.xp_awarded, 20);
  const second = (await run(db, "AFTER", "ADM", review(sub, true), "admin approves again")).rows[0].r;
  assert.equal(second.ok, false); assert.equal(second.reason, "not awaiting review");
  assert.equal((await peek(db, `select status from public.tasks where id = '${ID.DAILY}'`))[0].status, "completed");
  assert.equal((await peek(db, `select count(*)::int as n from public.xp_logs where student_id = '${ID.SA}'`))[0].n, 1);
  assert.equal((await peek(db, `select total_xp from public.student_profiles where id = '${ID.SA}'`))[0].total_xp, 20);
  const notes = await peek(db, `select type, title, message from public.notifications where user_id = '${ID.SA}'`);
  assert.equal(notes.length, 1); assert.equal(notes[0].type, "review_outcome");
  assert.doesNotMatch(notes[0].message, /copy|cheat|plagiar|suspic/i, "no accusation in the student's message");
});

test("a moot review (a later attempt already passed): error BEFORE 104, closed cleanly AFTER, no second XP", async (t) => {
  if (!need(t)) return;
  for (const with104 of [false, true]) {
    const db = await build({ with104 });
    await peek(db, `update public.tasks set xp_reward = 20 where id = '${ID.DAILY}'`);
    const old = await pendingFor(db, ID.DAILY, ID.SA, "first try");
    await peek(db, `insert into public.task_submissions (task_id, student_id, rubric_config_id, code, status, sandbox_score) values ('${ID.DAILY}', '${ID.SA}', '${ID.R1}', 'second try', 'passed', 90)`);
    const r = await run(db, with104 ? "AFTER" : "BEFORE", "ADM", review(old, true), "approve a moot review");
    if (!with104) { assert.equal(r.ok, false, "BEFORE: the one-pass index refuses it (stuck in the queue)"); assert.match(r.error, /duplicate key|unique/); continue; }
    assert.equal(r.rows[0].r.status, "already_completed");
    assert.equal((await peek(db, `select status from public.task_submissions where id = '${old}'`))[0].status, "failed");
    assert.equal((await peek(db, `select count(*)::int as n from public.xp_logs where student_id = '${ID.SA}'`))[0].n, 0, "no XP from a moot review");
    assert.equal((await peek(db, `select count(*)::int as n from public.task_submissions where status = 'needs_review'`))[0].n, 0, "queue is empty");
  }
});

test("reject: failed, no XP, the student is told without an accusation", async (t) => {
  if (!need(t)) return;
  const db = await build({ with104: true });
  const sub = await pendingFor(db, ID.DAILY, ID.SA);
  const r = (await run(db, "AFTER", "TPO1", review(sub, false), "own college rejects")).rows[0].r;
  assert.equal(r.status, "failed");
  assert.equal((await peek(db, `select count(*)::int as n from public.xp_logs`))[0].n, 0);
  const note = (await peek(db, `select message from public.notifications where user_id = '${ID.SA}'`))[0].message;
  assert.match(note, /did not pass this time/); assert.doesNotMatch(note, /copy|cheat|plagiar|suspic/i);
});

test("who may review: admin and the student's own approved college only", async (t) => {
  if (!need(t)) return;
  const db = await build({ with104: true });
  const sub = await pendingFor(db, ID.DAILY, ID.SA);
  for (const who of ["TPO2", "TPOP", "CO1", "SB"]) {
    const r = await run(db, "AFTER", who, review(sub, true), `${who} reviews SA`);
    assert.equal(r.rows[0]?.r.reason, "forbidden", `${who} must be refused`);
  }
  assert.equal((await run(db, "AFTER", "ANON", review(sub, true), "anon reviews")).ok, false);
  assert.equal((await run(db, "AFTER", "TPO1", review(sub, true), "own college approves")).rows[0].r.status, "passed");
});

test("daily digest: one per reviewer per day, only the right college, nothing when the queue is empty", async (t) => {
  if (!need(t)) return;
  const db = await build({ with104: true });
  const empty = (await run(db, "AFTER", "SERVICE", `select public.notify_pending_reviews() as r`, "digest with empty queue")).rows[0].r;
  assert.equal(empty.pending, 0);
  await pendingFor(db, ID.DAILY, ID.SA);
  const first = (await run(db, "AFTER", "SERVICE", `select public.notify_pending_reviews() as r`, "digest")).rows[0].r;
  assert.deepEqual([first.pending, first.admins, first.colleges], [1, 1, 1]);
  const again = (await run(db, "AFTER", "SERVICE", `select public.notify_pending_reviews() as r`, "digest again same day")).rows[0].r;
  assert.deepEqual([again.admins, again.colleges], [0, 0], "no duplicate alerts");
  const who = (await peek(db, `select user_id from public.notifications where type = 'review_digest' order by user_id`)).map((r) => r.user_id);
  assert.deepEqual(who.sort(), [ID.TPO1, ID.ADM].sort(), "admin + SA's college only (not TPO2, not the pending college)");
});

test("104 keeps 91 and 103 in record_task_submission; rollback restores migration 86's review function exactly", async (t) => {
  if (!need(t)) return;
  const db = await build({ with104: false });
  const md5 = async () => (await peek(db, `select md5(pg_get_functiondef('${SIG}'::regprocedure)) as m`))[0].m;
  const before86 = await md5();
  const rts = async () => (await peek(db, `select pg_get_functiondef('public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure) as d`))[0].d;
  const rtsBefore = await rts();
  await db.exec(M104);
  assert.notEqual(await md5(), before86);
  assert.equal(await rts(), rtsBefore, "record_task_submission untouched by 104");
  await db.exec(R104);
  assert.equal(await md5(), before86, "rollback = migration 86's function, byte for byte");
  assert.equal((await peek(db, `select to_regprocedure('public.similar_written_answer(uuid, uuid, text)') is null as gone`))[0].gone, true);
});

test("write evidence (when S31_OUT is set)", () => {
  if (!process.env.S31_OUT) return;
  mkdirSync(process.env.S31_OUT, { recursive: true });
  writeFileSync(join(process.env.S31_OUT, "s31-review-scenarios.json"), JSON.stringify({ kind: "OFFLINE SIMULATION on PGlite (PostgreSQL 16, in-memory). Not a live database.", scenarios: log }, null, 1));
});
