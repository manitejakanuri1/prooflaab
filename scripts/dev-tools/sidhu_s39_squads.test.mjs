// S39: squads below eleven are filled from the reserve (migration 108), and the import Branch list (migration 109).
// OFFLINE, IN-MEMORY, on a real PostgreSQL 16 engine (PGlite). The squad functions are the deployed ones, cut out of
// their migrations (sidhu_s39_squad_fixture.mjs). Concurrency with two real sessions: sidhu_s39_squads_concurrency.test.mjs.
//
//   PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/sidhu_s39_squads.test.mjs
//
// Without PGlite every test is SKIPPED, never passed; the CI workflow refuses skips.
import test from "node:test";
import assert from "node:assert/strict";
import { ID, FIXTURE, FORM_SQUADS, M108, R108, M109, students, squad, active, placedIn, uuid } from "./sidhu_s39_squad_fixture.mjs";

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped below */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

async function database({ with108 = true } = {}) {
  const db = new PGlite();
  await db.exec(FIXTURE);
  if (with108) await db.exec(M108);
  return db;
}
async function as(db, role, userId, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId ?? "", role })}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
}
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0] ?? { v: null })[0];
const form = async (db, college) => (await as(db, "service_role", null, `select public.form_squads('${college}') as r`)).rows[0].r;
// Line endings are not part of a function: the fixture reads the migration files as they are checked out.
const def = async (db, f) => (await one(db, `select pg_get_functiondef('${f}'::regprocedure)`)).replace(/\r\n/g, "\n");
const seed = async (db, ...parts) => { for (const p of parts) if (p.sql) await db.exec(p.sql); };

// ------------------------------------------------------------------ the migration itself
test("108 applies to the deployed form_squads, passes its own self-check, and runs twice without a second change", { skip }, async () => {
  const db = await database();
  const once = await def(db, "public.form_squads(uuid,uuid)");
  await db.exec(M108);
  assert.equal(await def(db, "public.form_squads(uuid,uuid)"), once, "second run changes nothing");
  assert.equal(once.split("-- 108:").length - 1, 3, "three marked edits, once each");
  assert.ok(once.includes("limit k * 11"), "drawing new squads of eleven is untouched");
});

test("108 refuses a form_squads that is not the migration 59 version, and changes nothing", { skip }, async () => {
  const db = await database({ with108: false });
  await db.exec(FORM_SQUADS.replace("< 11\n", "< 10\n").replace("< 11\r\n", "< 10\r\n"));
  const before = await def(db, "public.form_squads(uuid,uuid)");
  await assert.rejects(db.exec(M108), /not the migration 59 version/);
  await db.exec("rollback");
  assert.equal(await def(db, "public.form_squads(uuid,uuid)"), before);
  assert.ok(!(await def(db, "public.form_all_colleges()")).includes("colleges_failed"), "form_all_colleges untouched too");
});

test("privileges: browser roles cannot run form_squads or form_all_colleges; a college runs its own through Generate", { skip }, async () => {
  const db = await database();
  await assert.rejects(as(db, "authenticated", ID.TPO_A, `select public.form_squads('${ID.A}')`), /permission denied/);
  await assert.rejects(as(db, "authenticated", ID.TPO_A, `select public.form_all_colleges()`), /permission denied/);
  await assert.rejects(as(db, "anon", null, `select public.form_squads('${ID.A}')`), /permission denied/);
  const s = squad(ID.A, ID.SA, "CSE-A", []); const r = students(ID.A, "CSE-A", 3);
  await seed(db, s, r);
  const out = (await as(db, "authenticated", ID.TPO_A, `select public.tpo_form_squads() as r`)).rows[0].r;
  assert.equal(out.students_placed, 3);
});

test("rollback restores both functions exactly; 108 can be applied again; placements made meanwhile stay", { skip }, async () => {
  const pre = await database({ with108: false });
  const fs59 = await def(pre, "public.form_squads(uuid,uuid)");
  const fac33 = await def(pre, "public.form_all_colleges()");
  const db = await database();
  const s = squad(ID.A, ID.SA, "CSE-A", []); const r = students(ID.A, "CSE-A", 2);
  await seed(db, s, r);
  await form(db, ID.A);
  await db.exec(R108);
  assert.equal(await def(db, "public.form_squads(uuid,uuid)"), fs59);
  assert.equal(await def(db, "public.form_all_colleges()"), fac33);
  assert.equal(await one(db, active(s.id)), 2, "nobody is unplaced by a rollback");
  await db.exec(M108);
  assert.ok((await def(db, "public.form_squads(uuid,uuid)")).includes("-- 108:"));
});

// ------------------------------------------------------------------ the root cause: a locked squad
test("ROOT CAUSE (before 108): one locked squad with a free seat makes the whole college's run fail; the nightly job hides it", { skip }, async () => {
  const db = await database({ with108: false });
  const locked = squad(ID.A, ID.SA, "CSE-A", students(ID.A, "CSE-A", 0).ids, { locked: true });
  const open = squad(ID.A, ID.SA, "ECE-A", []);
  const r1 = students(ID.A, "CSE-A", 1); const r2 = students(ID.A, "ECE-A", 4);
  await seed(db, locked, open, r1, r2);
  await assert.rejects(form(db, ID.A), /is locked/);
  const nightly = (await as(db, "service_role", null, `select public.form_all_colleges() as r`)).rows[0].r;
  assert.equal(nightly.ok, true);
  assert.equal(nightly.students_placed, 0, "reported ok, placed nobody, said nothing");
  assert.equal(await one(db, active(open.id)), 0, "even the unlocked ECE squad got nobody");
});

test("108: a locked squad is skipped, the rest of the college is filled, and the run succeeds", { skip }, async () => {
  const db = await database();
  const locked = squad(ID.A, ID.SA, "CSE-A", [], { locked: true });
  const open = squad(ID.A, ID.SA, "ECE-A", []);
  const r1 = students(ID.A, "CSE-A", 1); const r2 = students(ID.A, "ECE-A", 4);
  await seed(db, locked, open, r1, r2);
  const out = await form(db, ID.A);
  assert.equal(out.students_placed, 4);
  assert.equal(await one(db, active(locked.id)), 0, "the locked squad is the college's to fill");
  assert.equal(await one(db, active(open.id)), 4);
  assert.equal(await one(db, placedIn(r1.ids[0])), null, "its section's reserve waits");
});

test("108: the nightly job reports a college that failed (partial_failure), and still runs the others", { skip }, async () => {
  const db = await database();
  await db.exec(`update public.colleges set name = 'BROKEN' where id = '${ID.B}'`);
  const m = students(ID.A, "CSE-A", 10); const s = squad(ID.A, ID.SA, "CSE-A", m.ids); const r = students(ID.A, "CSE-A", 1);
  await seed(db, m, s, r);
  const nightly = (await as(db, "service_role", null, `select public.form_all_colleges() as r`)).rows[0].r;
  assert.equal(nightly.status, "partial_failure");
  assert.equal(nightly.colleges_failed, 1);
  assert.match(nightly.first_error, new RegExp(`^${ID.B}: season could not be opened`));
  assert.equal(nightly.students_placed, 1, "college A was still filled");
  await db.exec(`update public.colleges set name = 'College B' where id = '${ID.B}'`);
  const clean = (await as(db, "service_role", null, `select public.form_all_colleges() as r`)).rows[0].r;
  assert.deepEqual([clean.status, clean.colleges_failed, clean.first_error], ["success", 0, null]);
});

// ------------------------------------------------------------------ squad sizes 0, 1, 7, 10, 11, 12
for (const [have, reserve, expectNow, expectLeft] of [[0, 11, 11, 0], [0, 3, 3, 0], [1, 20, 11, 10], [7, 2, 9, 0], [10, 5, 11, 4], [11, 3, 11, 3], [12, 3, 12, 3]]) {
  test(`a squad of ${have} with ${reserve} in reserve ends with ${expectNow}; ${expectLeft} wait (seat twelve stays free)`, { skip }, async () => {
    const db = await database();
    const members = students(ID.A, "CSE-A", have);
    const s = squad(ID.A, ID.SA, "CSE-A", members.ids);
    const r = students(ID.A, "CSE-A", reserve);
    await seed(db, members, s, r);
    const out = await form(db, ID.A);
    assert.equal(await one(db, active(s.id)), expectNow);
    assert.equal(out.reserve, expectLeft);
    assert.equal(out.squads_created, 0, "fewer than eleven left over never draws a new squad");
  });
}

test("eleven or more left after filling still draw a new squad of eleven, exactly as before", { skip }, async () => {
  const db = await database();
  const m = students(ID.A, "CSE-A", 9); const s = squad(ID.A, ID.SA, "CSE-A", m.ids); const r = students(ID.A, "CSE-A", 14);
  await seed(db, m, s, r);
  const out = await form(db, ID.A);
  assert.deepEqual([await one(db, active(s.id)), out.squads_created, out.reserve], [11, 1, 1]);
});

test("a squad the college set to nine seats is filled to nine, not eleven", { skip }, async () => {
  const db = await database();
  const m = students(ID.A, "CSE-A", 6); const s = squad(ID.A, ID.SA, "CSE-A", m.ids, { max: 9 }); const r = students(ID.A, "CSE-A", 5);
  await seed(db, m, s, r);
  await form(db, ID.A);
  assert.equal(await one(db, active(s.id)), 9);
});

test("the emptiest squad of the section is filled first", { skip }, async () => {
  const db = await database();
  const m1 = students(ID.A, "CSE-A", 10); const m2 = students(ID.A, "CSE-A", 7);
  const s1 = squad(ID.A, ID.SA, "CSE-A", m1.ids); const s2 = squad(ID.A, ID.SA, "CSE-A", m2.ids);
  const r = students(ID.A, "CSE-A", 3);
  await seed(db, m1, m2, s1, s2, r);
  await form(db, ID.A);
  assert.deepEqual([await one(db, active(s1.id)), await one(db, active(s2.id))], [10, 10]);
});

// ------------------------------------------------------------------ who may be promoted, and where
test("never across sections, branches, colleges or seasons; never archived squads; never blocked students", { skip }, async () => {
  const db = await database();
  const mine = students(ID.A, "CSE-A", 8); const s = squad(ID.A, ID.SA, "CSE-A", mine.ids);
  const oldSeason = squad(ID.A, ID.OLD, "CSE-A", []);
  const archived = squad(ID.A, ID.SA, "CSE-A", [], { archived: true });
  const otherSection = students(ID.A, "CSE-B", 2);
  const otherBranch = students(ID.A, "ECE-A", 2);
  const otherCollege = students(ID.B, "CSE-A", 2);
  const blocked = students(ID.A, "CSE-A", 2, { blocked: true });
  await seed(db, mine, s, oldSeason, archived, otherSection, otherBranch, otherCollege, blocked);
  const out = await form(db, ID.A);
  assert.equal(out.students_placed, 0);
  assert.equal(await one(db, active(s.id)), 8);
  assert.equal(await one(db, active(oldSeason.id)), 0, "an old season's squad is not refilled");
  assert.equal(await one(db, active(archived.id)), 0);
  for (const id of [...otherSection.ids, ...otherBranch.ids, ...otherCollege.ids, ...blocked.ids]) {
    assert.equal(await one(db, placedIn(id)), null);
  }
  await form(db, ID.B);
  assert.equal(await one(db, `select count(*)::int from public.squad_members m join public.squads q on q.id = m.squad_id where q.college_id = '${ID.A}' and m.student_id in (${otherCollege.ids.map((i) => `'${i}'`).join(",")})`), 0);
});

test("a student already in another squad is never moved, and nobody is ever in two squads", { skip }, async () => {
  const db = await database();
  const a = students(ID.A, "CSE-A", 11); const full = squad(ID.A, ID.SA, "CSE-A", a.ids);
  const b = students(ID.A, "CSE-A", 4); const short = squad(ID.A, ID.SA, "CSE-A", b.ids);
  const r = students(ID.A, "CSE-A", 2);
  await seed(db, a, full, b, short, r);
  for (let i = 0; i < 3; i++) await form(db, ID.A);
  assert.equal(await one(db, active(full.id)), 11);
  assert.equal(await one(db, active(short.id)), 6);
  assert.equal(await one(db, `select count(*)::int from (select student_id from public.squad_members where left_at is null group by 1 having count(*) > 1) d`), 0);
});

test("idempotent: a second run places nobody, writes no second membership and sends no second notice", { skip }, async () => {
  const db = await database();
  const m = students(ID.A, "CSE-A", 7); const s = squad(ID.A, ID.SA, "CSE-A", m.ids); const r = students(ID.A, "CSE-A", 4);
  await seed(db, m, s, r);
  const first = await form(db, ID.A);
  const rows = await one(db, `select count(*)::int from public.squad_members`);
  const notices = await one(db, `select count(*)::int from public.notifications where type = 'squad_placed'`);
  const second = await form(db, ID.A);
  assert.deepEqual([first.students_placed, second.students_placed], [4, 0]);
  assert.equal(await one(db, `select count(*)::int from public.squad_members`), rows);
  assert.equal(await one(db, `select count(*)::int from public.notifications where type = 'squad_placed'`), notices);
});

test("a seat taken by someone else in the middle of a run (unique_violation) is skipped; the run does not fail", { skip }, async () => {
  const db = await database();
  const m = students(ID.A, "CSE-A", 8); const s = squad(ID.A, ID.SA, "CSE-A", m.ids);
  const other = squad(ID.A, ID.SA, "CSE-B", []);
  const r = students(ID.A, "CSE-A", 3);
  await seed(db, m, s, other, r);
  // Stands in for the college's Assign landing between form_squads' read and its insert: the moment the run tries
  // to seat the first reserve, that student is put in another squad first, so the run's own insert collides.
  // In one session the stand-in placement is undone with the failed insert (same sub-transaction), so here the student
  // simply stays in reserve; that a real, committed placement by another session stands is proven on a real server
  // with two sessions (sidhu_s39_squads_concurrency.test.mjs).
  await db.exec(`
    create function pg_temp.race() returns trigger language plpgsql as $f$
    begin
      if new.student_id = '${r.ids[0]}' and new.squad_id = '${s.id}' then
        insert into public.squad_members (squad_id, student_id) values ('${other.id}', new.student_id);
      end if;
      return new;
    end $f$;
    create trigger race before insert on public.squad_members for each row execute function pg_temp.race();`);
  const out = await form(db, ID.A);
  assert.equal(out.students_placed, 2, "the other two reserves are still seated");
  assert.equal(await one(db, active(s.id)), 10);
  assert.equal(await one(db, `select count(*)::int from public.squad_members where student_id = '${r.ids[0]}' and left_at is null`), 0,
    "never seated twice");
});

// ------------------------------------------------------------------ history, scores, removal and import
test("history, points, results and audit are kept; a former member who left can be placed again", { skip }, async () => {
  const db = await database();
  const m = students(ID.A, "CSE-A", 9);
  const s = squad(ID.A, ID.SA, "CSE-A", m.ids, { points: 340, wins: 3 });
  const r = students(ID.A, "CSE-A", 1);
  await seed(db, m, s, r);
  await db.exec(`insert into public.weekly_results values ('${s.id}', 1, 120), ('${s.id}', 2, 220);
    update public.squad_members set left_at = now() where student_id = '${m.ids[0]}';`);
  const history = await one(db, `select count(*)::int from public.squad_members where left_at is not null`);
  await form(db, ID.A);
  assert.equal(await one(db, `select count(*)::int from public.squad_members where left_at is not null`), history, "left rows untouched");
  assert.equal(await one(db, active(s.id)), 10, "8 + the one who left + 1 reserve");
  assert.equal(await one(db, placedIn(m.ids[0])), s.id);
  assert.deepEqual((await db.query(`select points, wins from public.squads where id = '${s.id}'`)).rows[0], { points: 340, wins: 3 });
  assert.equal(await one(db, `select sum(points)::int from public.weekly_results`), 340);
  assert.equal(await one(db, `select count(*)::int from public.audit_log where action = 'SQUADS_FORMED'`), 1);
});

test("removal then import: the vacancy a removed student leaves is filled by the next student imported to that section", { skip }, async () => {
  const db = await database();
  const m = students(ID.A, "CSE-A", 11); const s = squad(ID.A, ID.SA, "CSE-A", m.ids);
  await seed(db, m, s);
  await db.exec(`delete from public.student_profiles where id = '${m.ids[3]}'`);   // what a removal does to the row
  assert.equal(await one(db, active(s.id)), 10);
  const imported = students(ID.A, "CSE-A", 1);
  await seed(db, imported);
  await form(db, ID.A);   // the import runs form_squads for the college
  assert.equal(await one(db, placedIn(imported.ids[0])), s.id);
  assert.equal(await one(db, active(s.id)), 11);
});

test("vacancies left unfilled before 108 are reconciled by the next run", { skip }, async () => {
  const db = await database({ with108: false });
  const locked = squad(ID.A, ID.SA, "ECE-A", [], { locked: true });
  const m = students(ID.A, "CSE-A", 6); const s = squad(ID.A, ID.SA, "CSE-A", m.ids);
  const r = students(ID.A, "CSE-A", 5); const e = students(ID.A, "ECE-A", 1);
  await seed(db, locked, m, s, r, e);
  await assert.rejects(form(db, ID.A), /is locked/);   // stuck every night before 108
  await db.exec(M108);
  await form(db, ID.A);
  assert.equal(await one(db, active(s.id)), 11);
});

test("fewer than eleven students and no squad: nothing is created, all wait for the college (policy unchanged)", { skip }, async () => {
  const db = await database();
  const r = students(ID.A, "CIVIL-A", 7);
  await seed(db, r);
  const out = await form(db, ID.A);
  assert.deepEqual([out.squads_created, out.students_placed, out.reserve], [0, 0, 7]);
});

// ------------------------------------------------------------------ the college's own controls, unchanged
test("Assign still uses the twelfth seat after auto-fill, and refuses a thirteenth", { skip }, async () => {
  const db = await database();
  const m = students(ID.A, "CSE-A", 9); const s = squad(ID.A, ID.SA, "CSE-A", m.ids); const r = students(ID.A, "CSE-A", 4);
  await seed(db, m, s, r);
  await form(db, ID.A);
  const waiting = (await db.query(`select id from public.student_profiles p where not exists (select 1 from public.squad_members x where x.student_id = p.id and x.left_at is null) order by roll_number`)).rows.map((x) => x.id);
  assert.equal(waiting.length, 2);
  const res = (await as(db, "authenticated", ID.TPO_A, `select public.assign_to_squad('${waiting[0]}', '${s.id}') as r`)).rows[0].r;
  assert.equal(res.members_now, 12);
  await assert.rejects(as(db, "authenticated", ID.TPO_A, `select public.assign_to_squad('${waiting[1]}', '${s.id}')`), /is full \(12 of 12\)/);
  await assert.rejects(as(db, "authenticated", ID.TPO_B, `select public.assign_to_squad('${waiting[1]}', '${s.id}')`), /another college/);
  assert.equal(await one(db, `select count(*)::int from public.audit_log where action = 'STUDENT_ASSIGNED_TO_SQUAD'`), 1);
});

test("Rebalance behaves exactly as before (places up to the squad's own limit; skips locked squads)", { skip }, async () => {
  const db = await database();
  const m = students(ID.A, "CSE-A", 11); const s = squad(ID.A, ID.SA, "CSE-A", m.ids);
  const locked = squad(ID.A, ID.SA, "CSE-A", [], { locked: true });
  const r = students(ID.A, "CSE-A", 2);
  await seed(db, m, s, locked, r);
  const out = (await as(db, "authenticated", ID.TPO_A, `select public.tpo_rebalance_squads() as r`)).rows[0].r;
  assert.deepEqual([out.students_placed, out.still_unplaced], [1, 1]);
  assert.equal(await one(db, active(s.id)), 12);
  assert.equal(await one(db, active(locked.id)), 0);
});

// ------------------------------------------------------------------ 109: the Branch list on College -> Import students
test("109: an empty theme table (staging today) gets the nine defaults; the dropdown list is the eight branches", { skip }, async () => {
  const db = await database();
  await db.exec(M109);
  const list = (await db.query(`select branch from public.squad_name_themes where college_id is null and branch <> '*' order by branch`)).rows.map((r) => r.branch);
  assert.deepEqual(list, ["AIML", "CIVIL", "CSE", "DS", "ECE", "EEE", "IT", "MECH"]);
});

test("109: twice changes nothing; an existing default and a college's own theme are left as they are", { skip }, async () => {
  const db = await database();
  await db.exec(`insert into public.squad_name_themes (branch, theme, college_id) values ('CSE', 'Kings', null), ('CSE', 'Lions', '${ID.A}')`);
  await db.exec(M109); await db.exec(M109);
  assert.equal(await one(db, `select count(*)::int from public.squad_name_themes where college_id is null`), 9);
  assert.equal(await one(db, `select theme from public.squad_name_themes where branch = 'CSE' and college_id is null`), "Kings");
  assert.equal(await one(db, `select theme from public.squad_name_themes where branch = 'CSE' and college_id = '${ID.A}'`), "Lions");
  await assert.rejects(as(db, "authenticated", ID.TPO_A, `insert into public.squad_name_themes (branch, theme) values ('X', 'Y')`), /permission denied/);
});

test("109 does not change how squads are named: a CSE squad drawn after 109 carries the CSE theme", { skip }, async () => {
  const db = await database();
  await db.exec(M109);
  const r = students(ID.A, "CSE-A", 11);
  await seed(db, r);
  await form(db, ID.A);
  assert.equal(await one(db, `select name from public.squads where college_id = '${ID.A}'`), "CSE-A Titans 1");
  void uuid;
});
