// S30 regression tests on a REAL PostgreSQL engine (PGlite, in-memory, throwaway). See sidhu_s30_pg_harness.mjs.
//
//   PGLITE_MODULE=<file URL of @electric-sql/pglite/dist/index.js> node --test scripts/dev-tools/sidhu_s30_pg_harness.test.mjs
//
// Every attack is run TWICE: on the BEFORE state (repository migrations without 103), where it must SUCCEED (so the
// harness is proven able to see it), and on the AFTER state (with migration/103 applied verbatim), where it must FAIL.
// Every legitimate flow must work AFTER. This is offline simulation, not live-database verification.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeDb, as, peek, ID, recordSubmission, recordCoding } from "./sidhu_s30_pg_harness.mjs";

let B, A, P;   // BEFORE, AFTER, and "migration 100 never ran" + 103
const log = [];
const note = (state, name, outcome) => log.push({ state, name, ...outcome });
let available = true;
before(async () => {
  try { B = (await makeDb({ fixed: false })).db; A = (await makeDb({ fixed: true })).db; P = (await makeDb({ fixed: true, preSelfClaim: true })).db; }
  catch (e) { if (/Cannot find|ERR_MODULE_NOT_FOUND|PGLITE/i.test(String(e))) available = false; else throw e; }
});
const need = (t) => { if (!available) t.skip("PGlite not installed (set PGLITE_MODULE)"); return available; };
const run = async (db, state, who, sql, name) => { const r = await as(db, who, sql); note(state, name, { who, ok: r.ok, error: r.error, rows: r.rows }); return r; };
const both = async (name, who, sql) => ({ before: await run(B, "BEFORE", who, sql, name), after: await run(A, "AFTER", who, sql, name) });
const ins = (cols) => `insert into public.tasks (${Object.keys(cols).join(", ")}) values (${Object.values(cols).map((v) => v === null ? "null" : `'${v}'`).join(", ")}) returning *`;

// ---------------------------------------------------------------- P0 S29-05: fabricated verified proof
test("S29-05 the full chain works BEFORE and is broken at every link AFTER", async (t) => {
  if (!need(t)) return;
  // Link 1: a student inserts a task for themselves.
  const self = await both("SA inserts a task for self", "SA", ins({ student_id: ID.SA, title: "Designed a distributed database", status: "pending" }));
  assert.equal(self.before.ok, true, "BEFORE: self insert must be possible (proves the harness sees the hole)");
  assert.equal(self.after.ok, false, "AFTER: self insert refused");
  const selfId = self.before.rows[0].id;
  // Link 2: grading_type PATCH attaches the generic checker AFTER protect_tasks froze rubric_config_id.
  const patch = await run(B, "BEFORE", "SA", `update public.tasks set grading_type = 'written' where id = '${selfId}' returning rubric_config_id`, "SA patches grading_type");
  assert.equal(patch.rows[0]?.rubric_config_id, ID.GENERIC, "BEFORE: generic checker attached by the patch");
  // Link 3+4: the server grades it and records a pass.
  const rec = await run(B, "BEFORE", "SERVICE", recordSubmission(selfId, ID.SA, ID.GENERIC), "server records SA's self task");
  assert.equal(rec.rows[0].r.status, "passed", "BEFORE: a self-authored task became a passed submission");
  // inserted_by cannot be chosen on INSERT, not even by a privileged insert: the trigger overwrites it.
  const forged = await peek(A, `insert into public.tasks (id, student_id, title, rubric_config_id, inserted_by) values ('00000000-0000-4000-8000-0000000005e1', '${ID.SA}', 'forged', '${ID.GENERIC}', '${ID.SA}') returning inserted_by`);
  assert.equal(forged[0].inserted_by, null);
  // AFTER: a self-authored row (as one inserted through the API before 103 would be marked) is refused at grading.
  await peek(A, `update public.tasks set inserted_by = '${ID.SA}' where id = '00000000-0000-4000-8000-0000000005e1'`);
  const recA = await run(A, "AFTER", "SERVICE", recordSubmission("00000000-0000-4000-8000-0000000005e1", ID.SA, ID.GENERIC), "server records a self-authored row");
  assert.equal(recA.rows[0].r.ok, false); assert.equal(recA.rows[0].r.reason, "self-authored task");
  // AFTER: the patch path is closed too (no student UPDATE on tasks; guard refuses if a policy ever reopens it).
  const patchA = await run(A, "AFTER", "SA", `update public.tasks set grading_type = 'written' where id = '${ID.DAILY}' returning id`, "SA patches own daily Lot");
  assert.equal(patchA.rows.length, 0);
  assert.equal((await peek(A, `select count(*)::int as n from public.task_submissions where student_id = '${ID.SA}' and status = 'passed'`))[0].n, 0);
});

test("S29-05 a student cannot call record_task_submission directly (both states)", async (t) => {
  if (!need(t)) return;
  const r = await both("SA calls record_task_submission", "SA", recordSubmission(ID.DAILY, ID.SA, ID.R1, 100));
  assert.match(r.before.error ?? "", /permission denied/); assert.match(r.after.error ?? "", /permission denied/);
});

test("record_task_submission AFTER: legitimate passes still work; wrong student or wrong checker refused", async (t) => {
  if (!need(t)) return;
  const daily = await run(A, "AFTER", "SERVICE", recordSubmission(ID.DAILY, ID.SA, ID.R1, 80), "daily Lot passed by its student");
  assert.equal(daily.rows[0].r.status, "passed");
  assert.equal((await peek(A, `select status from public.tasks where id = '${ID.DAILY}'`))[0].status, "completed");
  const assigned = await run(A, "AFTER", "SERVICE", recordSubmission(ID.ASSIGNED, ID.SB, ID.R1, 80), "assigned task passed by SB");
  assert.equal(assigned.rows[0].r.status, "passed");
  const stranger = await run(A, "AFTER", "SERVICE", recordSubmission(ID.SPONSORED, ID.SB, ID.R1, 80), "SB on SA's sponsored Lot");
  assert.equal(stranger.rows[0].r.reason, "not this student's task");
  const wrongChecker = await run(A, "AFTER", "SERVICE", recordSubmission(ID.SPONSORED, ID.SA, ID.GENERIC, 80), "SA with the generic checker on a Lot that has its own");
  assert.equal(wrongChecker.rows[0].r.reason, "checker does not belong to this task");
  const strangerBefore = await run(B, "BEFORE", "SERVICE", recordSubmission(ID.SPONSORED, ID.SB, ID.R1, 80), "BEFORE: SB on SA's sponsored Lot");
  assert.equal(strangerBefore.rows[0].r.ok, true, "BEFORE the database itself did not check the submitter");
});

// ---------------------------------------------------------------- P0 S29-03 / S29-02: tampering and inflated status
test("S29-03 title, sponsor and origin tampering: possible BEFORE, refused AFTER; admin edits still work", async (t) => {
  if (!need(t)) return;
  for (const [name, set, id] of [
    ["SA renames own daily Lot", `title = 'Built a compiler'`, ID.DAILY],
    ["SA rewrites a company-sponsored Lot's brief", `description = 'easy'`, ID.SPONSORED],
    ["SA re-points sponsorship to CO2", `sponsored_by = '${ID.CO2}'`, ID.SPONSORED],
    ["SA claims a company origin", `created_by_startup_id = '${ID.CO2}'`, ID.DAILY],
    ["SA makes own Lot public", `visibility = 'public'`, ID.DAILY],
    ["SA sets completed_at", `completed_at = now()`, ID.DAILY],
  ]) {
    const r = await both(name, "SA", `update public.tasks set ${set} where id = '${id}' returning id`);
    assert.equal(r.before.rows.length, 1, `BEFORE: ${name} should be possible`);
    assert.equal(r.after.rows.length, 0, `AFTER: ${name} must change nothing`);
  }
  const kept = await peek(A, `select title, sponsored_by from public.tasks where id = '${ID.SPONSORED}'`);
  assert.equal(kept[0].sponsored_by, ID.CO1);
  const adm = await run(A, "AFTER", "ADM", `update public.tasks set title = 'Edited by admin' where id = '${ID.DAILY}' returning title`, "admin edits a task");
  assert.equal(adm.rows[0]?.title, "Edited by admin");
});

test("S29-02 a student-inserted 'completed' task: stored BEFORE, impossible AFTER", async (t) => {
  if (!need(t)) return;
  const r = await both("SA inserts own completed task", "SA", ins({ student_id: ID.SA, title: "x", status: "completed" }));
  assert.equal(r.before.rows[0]?.status, "completed");
  assert.equal(r.after.ok, false);
});

// ---------------------------------------------------------------- P0 S29-01: college assignment
test("S29-01 college manual Assign Task: refused BEFORE, works AFTER for own students only", async (t) => {
  if (!need(t)) return;
  const payload = (student, college, extra = {}) => ins({ student_id: student, title: "College task", description: "Explain recursion", status: "Pending", visibility: "public", category: "general", created_by_type: "college", created_by_college_id: college, ...extra });
  const own = await both("TPO1 assigns to own student SA", "TPO1", payload(ID.SA, ID.C1));
  assert.equal(own.before.ok, false, "BEFORE: refused by RLS (the reported bug)");
  assert.equal(own.after.ok, true, `AFTER: works (${own.after.error ?? ""})`);
  const row = own.after.rows[0];
  assert.equal(row.status, "pending"); assert.equal(row.rubric_config_id, ID.GENERIC); assert.equal(row.grading_type, "written");
  assert.equal(row.visibility, "private"); assert.equal(row.inserted_by, ID.TPO1); assert.equal(row.xp_reward, 0);
  // The student sees it and can be graded on it (the college is not the student, so it is not self-authored).
  const seen = await run(A, "AFTER", "SA", `select id from public.tasks where id = '${row.id}'`, "SA sees the college task");
  assert.equal(seen.rows.length, 1);
  const graded = await run(A, "AFTER", "SERVICE", recordSubmission(row.id, ID.SA, ID.GENERIC, 75), "SA passes the college task");
  assert.equal(graded.rows[0].r.status, "passed");
  // Tenant isolation and forgery. No RETURNING: RETURNING also needs SELECT on the new row, which would hide a
  // missing INSERT check (a client can ask PostgREST for return=minimal). Count what was stored instead.
  const plain = (sql) => sql.replace(/ returning \*$/, "");
  for (const [name, who, sql] of [
    ["TPO1 assigns to another college's student", "TPO1", payload(ID.SC, ID.C1)],
    ["TPO1 claims College Two to reach its student", "TPO1", payload(ID.SC, ID.C2)],
    ["pending college assigns to its student", "TPOP", payload("00000000-0000-4000-8000-0000000000a4", ID.C3)],
    ["company inserts a task for a student", "CO1", payload(ID.SA, ID.C1)],
    ["student B inserts a college task for student A", "SB", payload(ID.SA, ID.C1)],
    ["anonymous inserts a task", "ANON", payload(ID.SA, ID.C1)],
  ]) {
    const n0 = (await peek(A, "select count(*)::int as n from public.tasks"))[0].n;
    const r = await run(A, "AFTER", who, plain(sql), name);
    const n1 = (await peek(A, "select count(*)::int as n from public.tasks"))[0].n;
    assert.equal(r.ok, false, `AFTER: ${name} must be refused`);
    assert.equal(n1, n0, `AFTER: ${name} must store nothing`);
  }
  // A college cannot smuggle privileged fields through its insert: clamped, not trusted.
  const smuggle = await run(A, "AFTER", "TPO1", payload(ID.SB, ID.C1, { sponsored_by: ID.CO1, rubric_config_id: ID.R1, status: "completed", lot_date: "2030-01-01" }), "TPO1 smuggles sponsor/checker/status");
  assert.equal(smuggle.ok, true);
  const s = smuggle.rows[0];
  assert.equal(s.sponsored_by, null); assert.equal(s.rubric_config_id, ID.GENERIC); assert.equal(s.status, "pending"); assert.equal(s.lot_date, null);
});

test("S29-01 Save as Template: refused BEFORE, works AFTER, and templates stay within the college", async (t) => {
  if (!need(t)) return;
  const tpl = `insert into public.task_templates (title, description, branch, difficulty, xp_reward) values ('TPO1 template', 'mine', null, 'Medium', 10) returning created_by`;
  const r = await both("TPO1 saves a template", "TPO1", tpl);
  assert.equal(r.before.ok, false); assert.equal(r.after.ok, true); assert.equal(r.after.rows[0].created_by, ID.TPO1);
  const tpo2 = await run(A, "AFTER", "TPO2", `select title from public.task_templates order by title`, "TPO2 lists templates");
  assert.deepEqual(tpo2.rows.map((x) => x.title), ["Admin template"], "TPO2 sees the admin template, not TPO1's");
  const tpo1 = await run(A, "AFTER", "TPO1", `select title from public.task_templates order by title`, "TPO1 lists templates");
  assert.deepEqual(tpo1.rows.map((x) => x.title), ["Admin template", "TPO1 template"]);
  for (const who of ["SA", "CO1", "TPOP", "ANON"]) {
    const x = await run(A, "AFTER", who, tpl, `${who} saves a template`);
    assert.equal(x.ok, false, `${who} must not save templates`);
  }
});

test("S29-01 audit log: refused BEFORE, recorded AFTER for the college's own tasks only", async (t) => {
  if (!need(t)) return;
  const task = (await run(A, "AFTER", "TPO1", ins({ student_id: ID.SA, title: "For audit", created_by_type: "college", created_by_college_id: ID.C1 }), "TPO1 creates a task for audit")).rows[0];
  const log1 = (rec, uid = ID.TPO1) => `insert into public.audit_logs (table_name, action, record_id, user_id, new_values) values ('tasks', 'Task Created', '${rec}', '${uid}', '{"title":"x"}') returning college_id, user_id`;
  const own = await run(A, "AFTER", "TPO1", log1(task.id), "TPO1 logs its task");
  assert.equal(own.ok, true, own.error); assert.equal(own.rows[0].college_id, ID.C1);
  const spoof = await run(A, "AFTER", "TPO1", log1(task.id, ID.ADM), "TPO1 logs as the admin");
  assert.equal(spoof.rows[0]?.user_id, ID.TPO1, "user_id is set by the trigger, not the caller");
  const beforeTask = (await peek(B, `insert into public.tasks (student_id, title, created_by_type, created_by_college_id) values ('${ID.SA}', 'b', 'college', '${ID.C1}') returning id`))[0].id;
  assert.equal((await run(B, "BEFORE", "TPO1", log1(beforeTask), "BEFORE: TPO1 logs")).ok, false);
  for (const [name, who, rec] of [["TPO1 logs a system Lot", "TPO1", ID.DAILY], ["TPO2 logs TPO1's task", "TPO2", task.id], ["student logs", "SA", task.id], ["company logs", "CO1", task.id]]) {
    assert.equal((await run(A, "AFTER", who, log1(rec, ID[who]), name)).ok, false, name);
  }
});

// ---------------------------------------------------------------- P1
test("S29-06 anonymous scorecard view: readable BEFORE, refused AFTER; signed-in still reads it", async (t) => {
  if (!need(t)) return;
  const r = await both("anon reads public_resume_scorecards", "ANON", `select student_id, resume_quality_score from public.public_resume_scorecards`);
  assert.equal(r.before.rows.length, 1, "BEFORE: anon reads a scorecard");
  assert.match(r.after.error ?? "", /permission denied/);
  const signed = await run(A, "AFTER", "CO1", `select student_id from public.public_resume_scorecards`, "signed-in reads the view");
  assert.equal(signed.rows.length, 1);
  const usage = await run(A, "AFTER", "ANON", `select * from public.llm_usage_by_student`, "anon reads llm_usage_by_student");
  assert.match(usage.error ?? "", /permission denied/);
});

test("S29-04 job posts: self-approval possible BEFORE, pending AFTER; admin and verified college keep publishing", async (t) => {
  if (!need(t)) return;
  const post = (who) => `insert into public.job_opportunities (role, company_name, status, created_by) values ('SWE', 'X', 'approved', '${ID[who]}') returning status`;
  const co = await both("company posts as approved", "CO1", post("CO1"));
  assert.equal(co.before.rows[0]?.status, "approved"); assert.equal(co.after.rows[0]?.status, "pending");
  assert.equal((await run(A, "AFTER", "TPOP", post("TPOP"), "pending college posts as approved")).rows[0]?.status, "pending");
  assert.equal((await run(A, "AFTER", "TPO1", post("TPO1"), "verified college posts")).rows[0]?.status, "approved");
  const pend = (await run(A, "AFTER", "CO1", `insert into public.job_opportunities (role, company_name, status, created_by) values ('QA', 'X', 'pending', '${ID.CO1}') returning id`, "company posts pending")).rows[0];
  const promote = await run(A, "AFTER", "CO1", `update public.job_opportunities set status = 'approved' where id = '${pend.id}' returning status`, "company approves its own post");
  assert.equal(promote.rows[0]?.status, "pending");
  const admin = await run(A, "AFTER", "ADM", `update public.job_opportunities set status = 'approved' where id = '${pend.id}' returning status`, "admin approves");
  assert.equal(admin.rows[0]?.status, "approved");
  assert.equal((await run(A, "AFTER", "SA", post("SA"), "student posts a job")).ok, false);
});

test("S29-08 role self-claim: an environment without migration 100 is closed by 103; admin claim never possible", async (t) => {
  if (!need(t)) return;
  // A signed-in account with NO role row yet: the case the self-claim policy was written for. Plain INSERT.
  const claim = (role) => `insert into public.user_roles (user_id, role) values ('${ID.NEWUSER}', '${role}')`;
  const pre = await as(P, "NEWUSER", claim("college_admin")); note("PRE100+103", "new account claims college_admin", pre);
  assert.equal(pre.ok, false, "103 drops the self-claim even where 100 never ran");
  for (const db of [B, A, P]) assert.equal((await as(db, "NEWUSER", claim("admin"))).ok, false, "admin is never self-claimable");
});

// ---------------------------------------------------------------- positive controls and order proof
test("positive controls: owners and admins still work; deny-all cannot pass", async (t) => {
  if (!need(t)) return;
  assert.equal((await run(A, "AFTER", "SA", `select id from public.tasks where id = '${ID.DAILY}'`, "SA reads own Lot")).rows.length, 1);
  assert.equal((await run(A, "AFTER", "SB", `select id from public.tasks where id = '${ID.ASSIGNED}'`, "SB reads assigned task")).rows.length, 1);
  assert.equal((await run(A, "AFTER", "SC", `select id from public.tasks where id = '${ID.DAILY}'`, "SC reads SA's Lot")).rows.length, 0);
  assert.equal((await run(A, "AFTER", "TPO1", `select id from public.tasks where id = '${ID.DAILY}'`, "TPO1 reads its student's Lot")).rows.length, 1);
  assert.equal((await run(A, "AFTER", "TPO2", `select id from public.tasks where id = '${ID.DAILY}'`, "TPO2 reads another college's Lot")).rows.length, 0);
  assert.equal((await run(A, "AFTER", "ANON", `select id from public.tasks`, "anon reads tasks")).rows.length, 0);
  assert.equal((await run(A, "AFTER", "ADM", ins({ student_id: ID.SC, title: "Admin task", created_by_type: "admin" }), "admin creates a task")).ok, true);
});

test("no student write policy remains on tasks AFTER (each layer is pinned on its own)", async (t) => {
  if (!need(t)) return;
  const pols = (await peek(A, `select policyname, cmd from pg_policies where tablename = 'tasks' and cmd in ('INSERT', 'UPDATE', 'ALL') order by policyname`)).map((r) => r.policyname);
  assert.deepEqual(pols, ["tasks_admin_insert", "tasks_admin_update", "tasks_college_insert"]);
});

test("trigger order on tasks AFTER: the integrity guard fires last among BEFORE UPDATE triggers", async (t) => {
  if (!need(t)) return;
  const names = (await peek(A, `select tgname from pg_trigger where tgrelid = 'public.tasks'::regclass and not tgisinternal and (tgtype & 2) = 2 and (tgtype & 16) = 16 order by tgname`)).map((r) => r.tgname);
  note("AFTER", "BEFORE UPDATE trigger order", { rows: names });
  assert.equal(names.at(-1), "tasks_zz_guard_integrity");
  assert.ok(names.indexOf("protect_tasks") < names.indexOf("task_default_checker"));
});

test("rollback: 103 then its rollback loads cleanly and restores the BEFORE behaviour (and re-opens the holes it warns about)", async (t) => {
  if (!need(t)) return;
  const { readFileSync } = await import("node:fs");
  const { db: R } = await makeDb({ fixed: true });
  await R.exec(readFileSync(new URL("../../migration/103-rollback-task-provenance-and-authz-repair.sql", import.meta.url), "utf8"));
  const self = await as(R, "SA", ins({ student_id: ID.SA, title: "self", status: "completed" }));
  note("ROLLBACK", "SA inserts own task", self);
  assert.equal(self.ok, true, "after rollback a student can again insert own tasks (documented warning)");
  const college = await as(R, "TPO1", ins({ student_id: ID.SA, title: "c", created_by_type: "college", created_by_college_id: ID.C1 }));
  assert.equal(college.ok, false, "after rollback college manual assignment is refused again");
  const anon = await as(R, "ANON", "select * from public.public_resume_scorecards");
  assert.match(anon.error ?? "", /permission denied/, "anon stays revoked on the scorecard view");
  const col = await peek(R, "select count(*)::int as n from information_schema.columns where table_name = 'tasks' and column_name = 'inserted_by'");
  assert.equal(col[0].n, 1, "inserted_by is kept");
});

const RTS = "public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])";
test("BEFORE state's record_task_submission is byte-identical to live staging (md5 of pg_get_functiondef)", async (t) => {
  if (!need(t)) return;
  if ((process.env.S30_LIVE_PATCHES ?? "91") !== "91") return t.skip("only meaningful for the staging patch set (91)");
  const m = (await peek(B, `select md5(pg_get_functiondef('${RTS}'::regprocedure)) as m`))[0].m;
  note("BEFORE", "record_task_submission md5", { rows: [m] });
  assert.equal(m, "f0930e15b377a178042ef468d3524fea", "live staging md5, read 9 Oct 2026 (staging-defs.log)");
});

test("103 keeps migration 91's every-test rule (and 93's, when present): 4/5 tests fails, 5/5 passes", async (t) => {
  if (!need(t)) return;
  const def = (await peek(A, `select pg_get_functiondef('${RTS}'::regprocedure) as d`))[0].d;
  assert.ok(def.includes("_passed_count = _total_count"), "91's rule is still in the function");
  assert.ok(def.includes("-- 103: a task its own student inserted is never evidence."), "103's checks are in the function");
  if ((process.env.S30_LIVE_PATCHES ?? "91").includes("93")) assert.ok(def.includes("hidden-summary"), "93's rule is still in the function");
  for (const [db, state] of [[B, "BEFORE"], [A, "AFTER"]]) {
    const partial = await run(db, state, "SERVICE", recordCoding(ID.CODING, ID.SC, ID.SANDBOX, 4, 5, 80), "coding 4 of 5 tests, score 80");
    assert.equal(partial.rows[0]?.r.status, "failed", `${state}: a partial coding pass is not 'passed' (${partial.error ?? ""})`);
  }
  const full = await run(A, "AFTER", "SERVICE", recordCoding(ID.CODING, ID.SC, ID.SANDBOX, 5, 5, 100), "coding 5 of 5 tests");
  assert.equal(full.rows[0]?.r.status, "passed");
});

test("write evidence (when S30_OUT is set)", () => {
  if (!process.env.S30_OUT) return;
  mkdirSync(process.env.S30_OUT, { recursive: true });
  writeFileSync(join(process.env.S30_OUT, "s30-pg-scenarios.json"), JSON.stringify({ kind: "OFFLINE SIMULATION on PGlite (PostgreSQL 16, in-memory). Not a live database.", scenarios: log }, null, 1));
});
