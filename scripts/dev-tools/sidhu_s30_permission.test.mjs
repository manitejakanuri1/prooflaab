// S30 offline permission tests (S29 suite + post-repair expectations for migration 103) with SYNTHETIC identities, decided from the policy model replayed out of the
// repository's migrations. No database, no SQL execution, no network.
//
//   node --test scripts/dev-tools/sidhu_s29_permission.test.mjs        (S30_OUT=<dir> also writes the matrix)
//
// Classification of a PASS here: LOCAL_TEST_VERIFIED against the source model. It is NOT proof of signed-in RLS
// behaviour on staging or production: the restored dump may hold objects the repository does not show, and a live
// database may not have every migration applied.
// A decision the evaluator cannot make (an atom it does not understand) is UNKNOWN; such tests FAIL loudly instead
// of passing silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { decide, model, world, actor, ID, T, F, U, evalExpr } from "./sidhu_s30_permission_eval.mjs";
import { buildModel, applyOrder } from "./sidhu_s30_policy_model.mjs";

const M = model();
const W = world();
W.tasks = [{ id: "college-task-1", student_id: ID.SA, created_by_college_id: ID.C1 }, { id: "daily-1", student_id: ID.SA, created_by_college_id: null }];
const matrix = [];
const check = (name, q, expected, extra) => {
  const r = decide(M, W, q);
  matrix.push({ name, table: q.table, op: q.op, actor: q.actor.key, expected, decision: r.decision, unknown: r.unknown ?? [], why: r.why, triggerNotes: r.triggerNotes ?? [] });
  assert.notEqual(r.decision, U, `${name}: UNKNOWN (not understood: ${(r.unknown ?? []).join(" | ")})`);
  assert.equal(r.decision, expected, `${name}: ${r.why}`);
  if (extra) extra(r);
  return r;
};
const A = actor;
const collegeOf = (k) => ({ SA: ID.C1, SB: ID.C1, SC: ID.C2 })[k];

// Owner-keyed rows for the student-owned tables written from the browser.
const STUDENT_TABLES = {
  student_certifications: (k) => ({ id: `cert-${k}`, student_id: ID[k] }),
  student_contact: (k) => ({ student_id: ID[k] }),
  student_portfolios: (k) => ({ student_id: ID[k], is_public: false }),
  resume_claims: (k) => ({ id: `claim-${k}`, student_id: ID[k] }),
  voice_explanations: (k) => ({ id: `voice-${k}`, student_id: ID[k] }),
  tasks: (k) => ({ id: `task-${k}`, student_id: ID[k], visibility: "private", sponsored_by: null, status: "pending", title: "Lot" }),
  student_profiles: (k) => ({ id: ID[k], user_id: ID[k], college_id: collegeOf(k), status: "active", cohort: "A" }),
  notifications: (k) => ({ id: `n-${k}`, user_id: ID[k] }),
  user_preferences: (k) => ({ user_id: ID[k] }),
};
const ALL21 = ["announcements", "audit_logs", "college_profiles", "colleges", "job_opportunities", "learning_resources", "notifications", "resume_claims", "startup_profiles", "startups", "student_certifications", "student_contact", "student_import_rows", "student_imports", "student_portfolios", "student_profiles", "task_rubric_config", "task_templates", "tasks", "user_preferences", "voice_explanations"];

test("model: all 21 browser-written tables exist with row level security on", () => {
  for (const t of ALL21) { const x = M.tables.get(t); assert.ok(x, t); assert.equal(x.rls, true, `${t} rls`); }
});

test("evaluator: understands every policy expression on the 21 tables (no UNKNOWN atoms)", () => {
  const unknown = [];
  for (const t of ALL21) for (const p of M.tables.get(t).policies.values()) for (const e of [p.using, p.check]) if (e) {
    const x = evalExpr(e, A("SA"), { student_id: ID.SA, id: ID.SA, college_id: ID.C1, user_id: ID.SA, import_id: "imp-1" }, W);
    if (x.unknown.length) unknown.push(`${t}.${p.name}: ${x.unknown.join(" | ")}`);
  }
  assert.deepEqual(unknown, []);
});

test("anonymous: no access to any of the 21 tables (select/insert/update/delete)", () => {
  for (const t of ALL21) for (const op of ["select", "insert", "update", "delete"]) {
    const row = { id: "x", student_id: ID.SA, user_id: ID.SA, college_id: ID.C1, created_by: ID.CO1, status: "approved", is_public: true, visibility: "public", import_id: "imp-1" };
    check(`anon ${op} ${t}`, { table: t, op, actor: A("ANON"), row, newRow: row }, F);
  }
});

test("cross-student: a student cannot read, change or delete another student's rows", () => {
  for (const [t, mk] of Object.entries(STUDENT_TABLES)) {
    for (const op of ["select", "update", "delete"]) {
      const other = mk("SB");
      const r = decide(M, W, { table: t, op, actor: A("SA"), row: other, newRow: { ...other } });
      if (r.decision === F) { matrix.push({ name: `SA ${op} SB ${t}`, table: t, op, actor: "SA", expected: F, decision: F, why: r.why }); continue; }
      // The one designed exception: tasks the other student made public are readable by everyone signed in.
      check(`SA ${op} SB ${t}`, { table: t, op, actor: A("SA"), row: other, newRow: { ...other } }, F);
    }
    // ... and cannot create a row in another student's name.
    if (t !== "student_profiles") check(`SA insert ${t} as SB`, { table: t, op: "insert", actor: A("SA"), row: {}, newRow: mk("SB") }, F);
  }
});

test("positive controls: the owner can use their own rows (the evaluator is not just denying)", () => {
  check("SA select own certification", { table: "student_certifications", op: "select", actor: A("SA"), row: STUDENT_TABLES.student_certifications("SA") }, T);
  check("SA delete own certification", { table: "student_certifications", op: "delete", actor: A("SA"), row: STUDENT_TABLES.student_certifications("SA") }, T);
  check("SA update own portfolio", { table: "student_portfolios", op: "update", actor: A("SA"), row: STUDENT_TABLES.student_portfolios("SA"), newRow: { ...STUDENT_TABLES.student_portfolios("SA"), is_public: true } }, T);
  check("SB reads a task assigned to SB", { table: "tasks", op: "select", actor: A("SB"), row: { id: "task-assigned-to-sb", student_id: ID.ADM, visibility: "private" } }, T);
  check("SA cannot read a task assigned to SB", { table: "tasks", op: "select", actor: A("SA"), row: { id: "task-assigned-to-sb", student_id: ID.ADM, visibility: "private" } }, F);
  check("admin updates any student profile", { table: "student_profiles", op: "update", actor: A("ADM"), row: STUDENT_TABLES.student_profiles("SC"), newRow: { ...STUDENT_TABLES.student_profiles("SC"), full_name: "x" } }, T);
});

test("cross-college: a college sees and edits only its own approved students", () => {
  const sa = STUDENT_TABLES.student_profiles("SA"), sc = STUDENT_TABLES.student_profiles("SC");
  check("TPO1 select own student", { table: "student_profiles", op: "select", actor: A("TPO1"), row: sa }, T);
  check("TPO1 select other college's student", { table: "student_profiles", op: "select", actor: A("TPO1"), row: sc }, F);
  check("pending college TPOP select a C3 student", { table: "student_profiles", op: "select", actor: A("TPOP"), row: { id: "s-c3", college_id: ID.C3 } }, F);
  check("TPO1 update other college's student", { table: "student_profiles", op: "update", actor: A("TPO1"), row: sc, newRow: { ...sc, status: "inactive" } }, F);
  check("TPO1 moving own student to C2 is kept in C1 (college_id frozen)", { table: "student_profiles", op: "update", actor: A("TPO1"), row: sa, newRow: { ...sa, college_id: ID.C2 } }, T,
    (r) => assert.equal(r.finalRow.college_id, ID.C1));
  check("TPO1 read own student's contact", { table: "student_contact", op: "select", actor: A("TPO1"), row: { student_id: ID.SA } }, T);
  check("TPO1 read other college's contact", { table: "student_contact", op: "select", actor: A("TPO1"), row: { student_id: ID.SC } }, F);
  check("TPO1 update other college's contact", { table: "student_contact", op: "update", actor: A("TPO1"), row: { student_id: ID.SC }, newRow: { student_id: ID.SC, email: "x" } }, F);
  check("TPO1 read own student's certification", { table: "student_certifications", op: "select", actor: A("TPO1"), row: { student_id: ID.SA } }, T);
  check("TPO2 read C1 student's certification", { table: "student_certifications", op: "select", actor: A("TPO2"), row: { student_id: ID.SA } }, F);
  check("TPO1 read C2 import", { table: "student_imports", op: "select", actor: A("TPO1"), row: { id: "imp-2", college_id: ID.C2 } }, F);
  check("TPO1 create import for C2", { table: "student_imports", op: "insert", actor: A("TPO1"), row: {}, newRow: { id: "imp-x", college_id: ID.C2 } }, F);
  check("TPO1 add rows to C2 import", { table: "student_import_rows", op: "insert", actor: A("TPO1"), row: {}, newRow: { import_id: "imp-2" } }, F);
  check("TPO1 read C2 audit log", { table: "audit_logs", op: "select", actor: A("TPO1"), row: { college_id: ID.C2 } }, F);
  check("TPO1 read own college", { table: "colleges", op: "select", actor: A("TPO1"), row: { id: ID.C1, user_id: ID.TPO1 } }, T);
  check("TPO1 read other college", { table: "colleges", op: "select", actor: A("TPO1"), row: { id: ID.C2, user_id: ID.TPO2 } }, F);
});

test("cross-company: a company cannot read students directly or touch another company", () => {
  check("CO1 select a student profile", { table: "student_profiles", op: "select", actor: A("CO1"), row: STUDENT_TABLES.student_profiles("SA") }, F);
  check("CO1 select a student's contact", { table: "student_contact", op: "select", actor: A("CO1"), row: { student_id: ID.SA } }, F);
  check("CO1 update own startups row (admin only)", { table: "startups", op: "update", actor: A("CO1"), row: { user_id: ID.CO1 }, newRow: { user_id: ID.CO1, name: "x" } }, F);
  check("CO1 read CO2 startups row", { table: "startups", op: "select", actor: A("CO1"), row: { user_id: ID.CO2 } }, F);
  check("CO1 update own startup profile", { table: "startup_profiles", op: "update", actor: A("CO1"), row: { user_id: ID.CO1 }, newRow: { user_id: ID.CO1, bio: "x" } }, T);
  check("CO1 update CO2 startup profile", { table: "startup_profiles", op: "update", actor: A("CO1"), row: { user_id: ID.CO2 }, newRow: { user_id: ID.CO2, bio: "x" } }, F);
  check("CO1 post a job as CO2", { table: "job_opportunities", op: "insert", actor: A("CO1"), row: {}, newRow: { created_by: ID.CO2, status: "pending" } }, F);
  check("CO1 edit CO2's job", { table: "job_opportunities", op: "update", actor: A("CO1"), row: { created_by: ID.CO2, status: "pending" }, newRow: { created_by: ID.CO2, status: "approved" } }, F);
  check("student posts a job (role check)", { table: "job_opportunities", op: "insert", actor: A("SA"), row: {}, newRow: { created_by: ID.SA, status: "pending" } }, F);
});

test("self-escalation is closed in the final source", () => {
  check("SA claims admin role", { table: "user_roles", op: "insert", actor: A("SA"), row: {}, newRow: { user_id: ID.SA, role: "admin" } }, F);
  check("SA claims college_admin role (self-claim dropped by migration 100)", { table: "user_roles", op: "insert", actor: A("SA"), row: {}, newRow: { user_id: ID.SA, role: "college_admin" } }, F);
  check("pending college approves itself: allowed update, status kept pending", { table: "colleges", op: "update", actor: A("TPOP"), row: { id: ID.C3, user_id: ID.TPOP, verification_status: "pending" }, newRow: { id: ID.C3, user_id: ID.TPOP, verification_status: "approved" } }, T,
    (r) => assert.equal(r.finalRow.verification_status, "pending"));
  check("student sets own college / status / xp: frozen", { table: "student_profiles", op: "update", actor: A("SA"), row: STUDENT_TABLES.student_profiles("SA"), newRow: { ...STUDENT_TABLES.student_profiles("SA"), college_id: ID.C2, status: "x", total_xp: 9999 } }, T,
    (r) => { assert.equal(r.finalRow.college_id, ID.C1); assert.equal(r.finalRow.status, "active"); });
  check("student inserts a voice row with a score: guard clears it", { table: "voice_explanations", op: "insert", actor: A("SA"), row: {}, newRow: { student_id: ID.SA, communication_score: 100, status: "scored" } }, T,
    (r) => { assert.equal(r.finalRow.communication_score, null); assert.equal(r.finalRow.status, "recorded"); });
});


// ---------------------------------------------------------------- S30: the same findings, after migration 103
test("S30 S29-05/S29-02: a student cannot insert any task (own or another's)", () => {
  check("SA inserts own task", { table: "tasks", op: "insert", actor: A("SA"), row: {}, newRow: { student_id: ID.SA, status: "completed", title: "x" } }, F);
  check("SA inserts a 'college' task for SB", { table: "tasks", op: "insert", actor: A("SA"), row: {}, newRow: { student_id: ID.SB, created_by_type: "college", created_by_college_id: ID.C1 } }, F);
});

test("S30 S29-03/S29-05: a student cannot update any task column", () => {
  const own = STUDENT_TABLES.tasks("SA");
  for (const [col, v] of [["title", "Designed a distributed database"], ["sponsored_by", ID.CO1], ["grading_type", "written"], ["created_by_startup_id", ID.CO2], ["visibility", "public"]]) {
    check(`SA updates own task ${col}`, { table: "tasks", op: "update", actor: A("SA"), row: own, newRow: { ...own, [col]: v }, set: [col] }, F);
  }
  check("admin still updates a task", { table: "tasks", op: "update", actor: A("ADM"), row: own, newRow: { ...own, title: "x" }, set: ["title"] }, T);
});

test("S30 S29-01: a verified college assigns to its own students only", () => {
  const task = (student, college) => ({ student_id: ID[student], created_by_type: "college", created_by_college_id: college });
  check("TPO1 -> SA (own)", { table: "tasks", op: "insert", actor: A("TPO1"), row: {}, newRow: task("SA", ID.C1) }, T);
  check("TPO1 -> SC (other college)", { table: "tasks", op: "insert", actor: A("TPO1"), row: {}, newRow: task("SC", ID.C1) }, F);
  check("TPO1 claims C2 -> SC", { table: "tasks", op: "insert", actor: A("TPO1"), row: {}, newRow: task("SC", ID.C2) }, F);
  check("pending college -> its student", { table: "tasks", op: "insert", actor: A("TPOP"), row: {}, newRow: { student_id: "s-c3", created_by_type: "college", created_by_college_id: ID.C3 } }, F);
  check("company -> SA", { table: "tasks", op: "insert", actor: A("CO1"), row: {}, newRow: task("SA", ID.C1) }, F);
  check("TPO1 without created_by_type college", { table: "tasks", op: "insert", actor: A("TPO1"), row: {}, newRow: { student_id: ID.SA, created_by_college_id: ID.C1 } }, F);
  check("TPO1 saves a template as itself", { table: "task_templates", op: "insert", actor: A("TPO1"), row: {}, newRow: { created_by: ID.TPO1 } }, T);
  check("student saves a template", { table: "task_templates", op: "insert", actor: A("SA"), row: {}, newRow: { created_by: ID.SA } }, F);
  check("pending college saves a template", { table: "task_templates", op: "insert", actor: A("TPOP"), row: {}, newRow: { created_by: ID.TPOP } }, F);
  check("TPO2 reads TPO1's template", { table: "task_templates", op: "select", actor: A("TPO2"), row: { created_by: ID.TPO1 } }, F);
  check("TPO2 reads an admin template", { table: "task_templates", op: "select", actor: A("TPO2"), row: { created_by: ID.ADM } }, T);
  check("TPO1 logs its own task", { table: "audit_logs", op: "insert", actor: A("TPO1"), row: {}, newRow: { user_id: ID.TPO1, college_id: ID.C1, table_name: "tasks", record_id: "college-task-1" } }, T);
  check("TPO1 logs a system Lot", { table: "audit_logs", op: "insert", actor: A("TPO1"), row: {}, newRow: { user_id: ID.TPO1, college_id: ID.C1, table_name: "tasks", record_id: "daily-1" } }, F);
  check("TPO2 logs TPO1's task", { table: "audit_logs", op: "insert", actor: A("TPO2"), row: {}, newRow: { user_id: ID.TPO2, college_id: ID.C2, table_name: "tasks", record_id: "college-task-1" } }, F);
  check("admin writes an audit log", { table: "audit_logs", op: "insert", actor: A("ADM"), row: {}, newRow: { user_id: ID.ADM } }, T);
});

test("S30 S29-08: no self-claim policy; admin claim never possible", () => {
  check("SA claims college_admin", { table: "user_roles", op: "insert", actor: A("SA"), row: {}, newRow: { user_id: ID.SA, role: "college_admin" } }, F);
  check("SA claims admin", { table: "user_roles", op: "insert", actor: A("SA"), row: {}, newRow: { user_id: ID.SA, role: "admin" } }, F);
});

// Not repaired in S30 (low severity, documented in the report): still open, asserted so a change is noticed.
test("S30 still open (low): student cohort is self-editable (S29-07)", () => {
  const sa = STUDENT_TABLES.student_profiles("SA");
  check("SA moves own cohort", { table: "student_profiles", op: "update", actor: A("SA"), row: sa, newRow: { ...sa, cohort: "B" } }, T, (r) => assert.equal(r.finalRow.cohort, "B"));
});

test("write the matrix (when S30_OUT is set)", () => {
  if (!process.env.S30_OUT) return;
  mkdirSync(process.env.S30_OUT, { recursive: true });
  writeFileSync(join(process.env.S30_OUT, "s30-permission-matrix.json"), JSON.stringify({ kind: "OFFLINE policy-model evaluation after migration 103 (not a live database)", rows: matrix }, null, 1));
});
