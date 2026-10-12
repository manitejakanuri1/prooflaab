// S39: squad vacancy filling under real concurrency: two or more sessions on a real PostgreSQL server at once.
// The nightly job, an import and the college's Generate button can all run form_squads for one college together,
// and the college can press Assign while it runs. PGlite has one session, so this needs a server.
//
//   PG_URL=postgres://postgres:postgres@localhost:5432/postgres PG_MODULE=file:///.../pg/lib/index.js \
//     node --test scripts/dev-tools/sidhu_s39_squads_concurrency.test.mjs
//
// Each test gets its own new database. Without PG_URL every test is SKIPPED, never passed; CI refuses skips.
import test from "node:test";
import assert from "node:assert/strict";
import { ID, FIXTURE, M108, students, squad, active } from "./sidhu_s39_squad_fixture.mjs";

let pg = null;
try { pg = (await import(process.env.PG_MODULE ?? "pg")).default; } catch { /* skipped below */ }
const skip = pg && process.env.PG_URL ? false : "no PostgreSQL server (set PG_URL and PG_MODULE)";

let n = 0;
async function database({ with108 = true } = {}) {
  const name = `s39_${process.pid}_${++n}`;
  const admin = new pg.Client({ connectionString: process.env.PG_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(process.env.PG_URL); url.pathname = `/${name}`;
  const open = async () => { const c = new pg.Client({ connectionString: url.toString() }); await c.connect(); return c; };
  const setup = await open();
  await setup.query(FIXTURE);
  if (with108) await setup.query(M108);
  return { setup, open };
}
const one = async (c, sql) => Object.values((await c.query(sql)).rows[0])[0];
const form = (c) => c.query(`select public.form_squads('${ID.A}') as r`).then((x) => x.rows[0].r);
/** Resolves once `pid` is waiting on a lock, so the order of events is certain, not a matter of timing. */
async function waitingOnLock(c, pid) {
  for (let i = 0; i < 200; i++) {
    if (await one(c, `select count(*)::int from pg_locks where pid = ${pid} and not granted`)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`session ${pid} never waited on a lock`);
}
const pidOf = (c) => one(c, "select pg_backend_pid()");

test("BEFORE 108: a second formation run for the same college fails when the first commits (same reserve, same seat)", { skip }, async () => {
  const { setup, open } = await database({ with108: false });
  const m = students(ID.A, "CSE-A", 5); const s = squad(ID.A, ID.SA, "CSE-A", m.ids); const r = students(ID.A, "CSE-A", 6);
  await setup.query(m.sql + s.sql + r.sql);
  const first = await open(); const second = await open();
  await first.query("begin"); await form(first);
  const running = form(second).then(() => "ok", (e) => e.code);
  await waitingOnLock(setup, await pidOf(second));
  await first.query("commit");
  assert.equal(await running, "23505", "unique_violation: the nightly job, an import or the button fails");
  for (const c of [first, second, setup]) await c.end();
});

test("108: runs at the same moment are taken one at a time; the second places nobody and does not fail", { skip }, async () => {
  const { setup, open } = await database();
  const m = students(ID.A, "CSE-A", 5); const s = squad(ID.A, ID.SA, "CSE-A", m.ids); const r = students(ID.A, "CSE-A", 6);
  await setup.query(m.sql + s.sql + r.sql);
  const first = await open(); const second = await open();
  await first.query("begin"); const a = await form(first);
  const running = form(second);
  await waitingOnLock(setup, await pidOf(second));   // waits on the college's advisory lock
  await first.query("commit");
  const b = await running;
  assert.deepEqual([a.students_placed, b.students_placed], [6, 0]);
  assert.equal(await one(setup, active(s.id)), 11);
  for (const c of [first, second, setup]) await c.end();
});

test("108: six runs fired together (nightly, imports, button) fill each seat once; nobody is placed twice", { skip }, async () => {
  const { setup, open } = await database();
  const parts = [];
  const squads = [];
  for (const [have, cohort] of [[3, "CSE-A"], [7, "CSE-A"], [10, "ECE-A"], [0, "ECE-A"]]) {
    const m = students(ID.A, cohort, have); const s = squad(ID.A, ID.SA, cohort, m.ids); parts.push(m, s); squads.push(s);
  }
  const r1 = students(ID.A, "CSE-A", 9); const r2 = students(ID.A, "ECE-A", 15); parts.push(r1, r2);
  await setup.query(parts.map((p) => p.sql).join("\n"));
  const sessions = await Promise.all(Array.from({ length: 6 }, open));
  const results = await Promise.all(sessions.map((c) => form(c)));
  assert.equal(results.reduce((t, x) => t + x.students_placed, 0), 9 + 12, "every placement counted once");
  assert.deepEqual(await Promise.all(squads.map((s) => one(setup, active(s.id)))), [10, 9, 11, 11], "emptiest first, never past eleven");
  assert.equal(await one(setup, `select count(*)::int from (select student_id from public.squad_members where left_at is null group by 1 having count(*) > 1) d`), 0);
  assert.equal(await one(setup, `select count(*)::int from public.student_profiles p where not exists (select 1 from public.squad_members m where m.student_id = p.id and m.left_at is null)`), 3, "ECE: 15 - 12 = 3 wait");
  for (const c of [...sessions, setup]) await c.end();
});

test("108: a student the college assigns while a run is under way keeps that squad; the run skips them and finishes", { skip }, async () => {
  const { setup, open } = await database();
  const m = students(ID.A, "CSE-A", 8); const s = squad(ID.A, ID.SA, "CSE-A", m.ids);
  const other = squad(ID.A, ID.SA, "CSE-B", []);
  const r = students(ID.A, "CSE-A", 3);
  await setup.query(m.sql + s.sql + other.sql + r.sql);
  const college = await open(); const job = await open();
  // The college presses Assign for the strongest reserve (the one the run would seat first) and has not committed yet.
  await college.query("begin");
  await college.query(`select set_config('request.jwt.claims', '{"sub":"${ID.TPO_A}","role":"authenticated"}', true)`);
  await college.query(`select public.assign_to_squad('${r.ids[0]}', '${other.id}')`);
  const running = form(job);
  await waitingOnLock(setup, await pidOf(job));      // the run's insert waits on the unique index
  await college.query("commit");
  const out = await running;
  assert.equal(out.students_placed, 2, "the other two reserves are seated");
  assert.equal(await one(setup, `select squad_id::text from public.squad_members where student_id = '${r.ids[0]}' and left_at is null`), other.id,
    "the college's choice stands");
  assert.equal(await one(setup, active(s.id)), 10);
  for (const c of [college, job, setup]) await c.end();
});
