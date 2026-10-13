// Migration 115 (pending college cannot sign in; exact reasons) on a real PostgreSQL engine (PGlite). OFFLINE.
// BEFORE = 102's web_login_identity text verbatim, renamed to web_login_identity_base and wrapped by 110's wrapper
// verbatim (taken from 115's rollback file, which is 110's text). AFTER = 115 applied exactly as written.
//
//   PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/teja_college_approval_115.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const M102 = read("migration/102-student-access-enforcement.sql");
const M110 = read("migration/110-identity-lifecycle-all-roles.sql");
const M115 = read("migration/115-college-approval-gates-login.sql");
const R115 = read("migration/115-rollback-college-approval-gates-login.sql");
const MIRROR = read("supabase/migrations/20261103010500_college_approval_gates_login.sql");

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped below */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const slice = (text, from, to) => { const a = text.indexOf(from), b = text.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return text.slice(a, b + to.length); };
const BASE_102 = slice(M102, "create or replace function public.web_login_identity(", "end;\n$$;");
const WRAPPER_110 = slice(M110, "create or replace function public.web_login_identity(_user_id uuid)", "grant execute on function public.web_login_identity(uuid) to service_role;");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = {
  TPO_OK: id(1), TPO_PENDING: id(2), TPO_SUSP: id(3), TPO_REJ: id(4), TPO_NONE: id(5),
  STU_OK: id(11), STU_PENDING_COL: id(12), STU_SUSP_COL: id(13), STU_SELF_SUSP: id(14),
  ADMIN: id(21), COMPANY: id(22), NOROLE: id(23), BLOCKED: id(24),
};
const C = { OK: id(101), PENDING: id(102), SUSP: id(103), REJ: id(104) };

const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
create type public.app_role as enum ('admin', 'student', 'college_admin', 'startup', 'recruiter');
create table public.user_roles (user_id uuid primary key, role public.app_role not null, has_completed_wizard boolean default true);
create table public.colleges (id uuid primary key, user_id uuid, name text, status text, verification_status text);
create table public.startups (id uuid primary key default gen_random_uuid(), user_id uuid, name text, status text, verification_status text);
create table public.student_profiles (id uuid primary key, user_id uuid, full_name text, college_id uuid, status text, onboarding_status text);
create table public.blocked (user_id uuid primary key);
create function public.identity_access_blocked(_u uuid) returns boolean language sql stable as $$ select exists (select 1 from public.blocked where user_id = _u) $$;
${BASE_102}
alter function public.web_login_identity(uuid) rename to web_login_identity_base;
${WRAPPER_110}
insert into public.colleges values
  ('${C.OK}', '${U.TPO_OK}', 'Live College', 'active', 'approved'),
  ('${C.PENDING}', '${U.TPO_PENDING}', 'Pending College', 'active', 'pending'),
  ('${C.SUSP}', '${U.TPO_SUSP}', 'Suspended College', 'suspended', 'approved'),
  ('${C.REJ}', '${U.TPO_REJ}', 'Rejected College', 'active', 'rejected');
insert into public.user_roles (user_id, role) values
  ('${U.TPO_OK}', 'college_admin'), ('${U.TPO_PENDING}', 'college_admin'), ('${U.TPO_SUSP}', 'college_admin'),
  ('${U.TPO_REJ}', 'college_admin'), ('${U.TPO_NONE}', 'college_admin'),
  ('${U.STU_OK}', 'student'), ('${U.STU_PENDING_COL}', 'student'), ('${U.STU_SUSP_COL}', 'student'), ('${U.STU_SELF_SUSP}', 'student'),
  ('${U.ADMIN}', 'admin'), ('${U.COMPANY}', 'startup'), ('${U.BLOCKED}', 'college_admin');
insert into public.colleges values ('${id(105)}', '${U.BLOCKED}', 'Blocked Owner College', 'active', 'approved');
insert into public.student_profiles values
  ('${U.STU_OK}', '${U.STU_OK}', 'A', '${C.OK}', 'active', 'completed'),
  ('${U.STU_PENDING_COL}', '${U.STU_PENDING_COL}', 'B', '${C.PENDING}', 'active', 'completed'),
  ('${U.STU_SUSP_COL}', '${U.STU_SUSP_COL}', 'C', '${C.SUSP}', 'active', 'completed'),
  ('${U.STU_SELF_SUSP}', '${U.STU_SELF_SUSP}', 'D', '${C.OK}', 'suspended', 'completed');
insert into public.startups (user_id, name, status, verification_status) values ('${U.COMPANY}', 'Co', 'pending', 'pending');
insert into auth.users (id, raw_user_meta_data) values ('${U.ADMIN}', '{"full_name":"Admin"}');
insert into public.blocked values ('${U.BLOCKED}');
`;

async function db(...more) { const d = new PGlite(); await d.exec(FIXTURE); for (const m of more) await d.exec(m); return d; }
const rule = async (d, u) => (await d.query(`select public.web_login_identity('${u}') r`)).rows[0].r;

test("115 mirror is byte-identical", () => assert.equal(MIRROR, M115));

test("BEFORE (102 + 110): a pending college admin is ALLOWED to sign in (the bug)", { skip }, async () => {
  const d = await db();
  assert.equal((await rule(d, U.TPO_PENDING)).allowed, true);
  assert.equal((await rule(d, U.STU_PENDING_COL)).reason, "student_not_college_managed");
});

const EXPECT = {
  TPO_PENDING: "college_pending_approval", TPO_SUSP: "college_suspended", TPO_REJ: "college_rejected",
  TPO_NONE: "college_account_unavailable", STU_PENDING_COL: "college_not_active", STU_SUSP_COL: "college_not_active",
  STU_SELF_SUSP: "student_not_college_managed", NOROLE: "account_not_provisioned", BLOCKED: "identity_missing",
};
test("AFTER 115: every refusal has its exact reason", { skip }, async () => {
  const d = await db(M115);
  for (const [who, reason] of Object.entries(EXPECT)) {
    const r = await rule(d, U[who]);
    assert.equal(r.allowed, false, who);
    assert.equal(r.reason, reason, who);
  }
});

test("control: approved college admin, its student, admin and company are still allowed exactly as before", { skip }, async () => {
  const before = await db(), after = await db(M115);
  for (const who of ["TPO_OK", "STU_OK", "ADMIN", "COMPANY"]) {
    const a = await rule(after, U[who]);
    assert.equal(a.allowed, true, who);
    assert.deepEqual(a, await rule(before, U[who]), `${who} answer changed`);
  }
});

test("approving the pending college lets its admin and students in at once", { skip }, async () => {
  const d = await db(M115);
  await d.exec(`update public.colleges set verification_status = 'approved' where id = '${C.PENDING}'`);
  assert.equal((await rule(d, U.TPO_PENDING)).allowed, true);
  assert.equal((await rule(d, U.STU_PENDING_COL)).allowed, true);
});

test("rollback restores 110's behaviour; 115 re-applies", { skip }, async () => {
  const d = await db(M115, R115);
  assert.equal((await rule(d, U.TPO_PENDING)).allowed, true, "rollback did not restore 110");
  await d.exec(M115);
  assert.equal((await rule(d, U.TPO_PENDING)).reason, "college_pending_approval");
});
