// S41: hiring write actions that had no test anywhere: a company reviews a submission on its own work
// (company_review_submission, migration 54) and an admin verifies a recruiter (admin_verify_recruiter, stage 35d),
// together with migration 84's keep_approval_closed trigger (nobody approves themselves). OFFLINE on PostgreSQL 16
// (PGlite), with the DEPLOYED function bodies cut from their migrations.
//   PGLITE_MODULE=file:///.../pglite/dist/index.js node --test scripts/dev-tools/sidhu_s41_hiring.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { read } from "./sidhu_s39_squad_fixture.mjs";

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const cut = (file, start, end) => { const t = read(file); const a = t.indexOf(start); const b = t.indexOf(end, a); if (a < 0 || b < 0) throw new Error(`${start} not in ${file}`); return t.slice(a, b + end.length); };
const M54 = "migration/54-company-submissions-on-task-submissions.sql";
const S35B = "supabase/migrations/20260903000100_stage35b_recruiter_workspace.sql";
const S35D = "supabase/migrations/20260903000300_stage35d_shortlist_sponsored_home.sql";
const M84 = "migration/84-no-self-approval-and-d3-d4-locks.sql";
const DEPLOYED = [
  cut(S35B, "create or replace function public.is_verified_recruiter()", "$fn$;"),
  cut(M54, "create or replace function public.my_company_ok()", "$$;"),
  cut(M54, "create or replace function public.company_review_submission(", "end $$;"),
  cut(S35D, "create or replace function public.admin_verify_recruiter(", "end $fn$;"),
  cut(M84, "create or replace function public.keep_approval_closed()", "end $$;"),
].join("\n");

const ID = {
  ADMIN: "00000000-0000-4000-8000-0000000000ad", CO: "00000000-0000-4000-8000-00000000c001", CO2: "00000000-0000-4000-8000-00000000c002",
  PENDING: "00000000-0000-4000-8000-00000000c003", REC: "00000000-0000-4000-8000-00000000e001", STU: "00000000-0000-4000-8000-0000000005a1",
  T1: "00000000-0000-4000-8000-0000000071a1", T2: "00000000-0000-4000-8000-0000000071a2", SUB1: "00000000-0000-4000-8000-0000000051b1", SUB2: "00000000-0000-4000-8000-0000000051b2",
};
const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $f$;
grant usage on schema auth, public to anon, authenticated, service_role;
create table public.user_roles (user_id uuid, role text);
create function public.has_role(_u uuid, _r text) returns boolean language sql stable security definer set search_path = public, pg_temp as
  $f$ select exists (select 1 from public.user_roles where user_id = _u and role = _r) $f$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $f$ select public.has_role(auth.uid(), 'admin') $f$;
create table public.recruiters (id uuid primary key, company text, verified boolean default false, verified_at timestamptz, verified_by uuid);
create table public.startups (user_id uuid primary key, name text, verification_status text default 'pending');
create table public.tasks (id uuid primary key, title text, created_by_startup_id uuid, sponsored_by uuid);
create table public.task_submissions (id uuid primary key, task_id uuid references public.tasks(id), student_id uuid);
create table public.submission_reviews (submission_id uuid primary key, reviewer_id uuid, decision text, note text, reviewed_at timestamptz default now());
create table public.audit_logs (action text, record uuid, new jsonb);
create function public.write_audit(_a text, _t text, _r uuid, _o jsonb default null, _n jsonb default null, _c uuid default null) returns void
  language sql security definer set search_path = public, pg_temp as $f$ insert into public.audit_logs values (_a, _r, _n) $f$;
grant select, update on public.recruiters, public.startups to authenticated;
${DEPLOYED}
create trigger keep_approval_closed before insert or update on public.recruiters for each row execute function public.keep_approval_closed();
create trigger keep_approval_closed before insert or update on public.startups for each row execute function public.keep_approval_closed();
revoke all on function public.company_review_submission(uuid, text, text) from public, anon;
grant execute on function public.company_review_submission(uuid, text, text) to authenticated;
insert into public.user_roles values ('${ID.ADMIN}', 'admin'), ('${ID.CO}', 'startup'), ('${ID.CO2}', 'startup'), ('${ID.PENDING}', 'startup'), ('${ID.REC}', 'startup'), ('${ID.STU}', 'student');
insert into public.startups values ('${ID.CO}', 'Acme', 'approved'), ('${ID.CO2}', 'Other Co', 'approved'), ('${ID.PENDING}', 'New Co', 'pending');
insert into public.recruiters (id, company, verified) values ('${ID.REC}', 'Hire Inc', false);
insert into public.tasks values ('${ID.T1}', 'Acme Lot', '${ID.CO}', null), ('${ID.T2}', 'Other Lot', '${ID.CO2}', null);
insert into public.task_submissions values ('${ID.SUB1}', '${ID.T1}', '${ID.STU}'), ('${ID.SUB2}', '${ID.T2}', '${ID.STU}');`;

async function db() { const d = new PGlite(); await d.exec(FIXTURE); return d; }
async function as(d, sub, sql) {
  await d.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: sub ?? "", role: "authenticated" })}', false);`);
  try { return await d.query(sql); } finally { await d.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}
const one = async (d, sql) => Object.values((await d.query(sql)).rows[0] ?? { v: null })[0];
const review = (sub, decision = "accepted", note = "good") => `select public.company_review_submission('${sub}', '${decision}', '${note}') as r`;

test("company review: an approved company reviews a submission on its OWN Lot; the decision is stored and can be changed", { skip }, async () => {
  const d = await db();
  const r = (await as(d, ID.CO, review(ID.SUB1, "needs_work", "  add tests  "))).rows[0].r;
  assert.deepEqual(r, { ok: true, submission_id: ID.SUB1, decision: "needs_work" });
  assert.deepEqual((await d.query(`select reviewer_id::text, decision, note from public.submission_reviews`)).rows, [{ reviewer_id: ID.CO, decision: "needs_work", note: "add tests" }]);
  await as(d, ID.CO, review(ID.SUB1, "accepted", ""));
  assert.deepEqual((await d.query(`select decision, note from public.submission_reviews`)).rows, [{ decision: "accepted", note: null }], "one row, updated");
});

test("company review: another company's submission, an unknown decision, a pending company, a student, signed out: all refused, nothing stored", { skip }, async () => {
  const d = await db();
  await assert.rejects(as(d, ID.CO, review(ID.SUB2)), /No such submission on your work/);
  await assert.rejects(as(d, ID.CO, review(ID.SUB1, "hired")), /Unknown decision/);
  await assert.rejects(as(d, ID.PENDING, review(ID.SUB1)), /awaiting approval/);
  await assert.rejects(as(d, ID.STU, review(ID.SUB1)), /awaiting approval/);
  await assert.rejects(as(d, null, review(ID.SUB1)), /awaiting approval/);
  assert.equal(await one(d, `select count(*)::int from public.submission_reviews`), 0);
});

test("company review: a verified recruiter can review only Lots it sponsored", { skip }, async () => {
  const d = await db();
  await d.exec(`update public.recruiters set verified = true where id = '${ID.REC}'; update public.tasks set sponsored_by = '${ID.REC}' where id = '${ID.T2}';`);
  await as(d, ID.REC, review(ID.SUB2, "rejected", "no"));
  assert.equal(await one(d, `select decision from public.submission_reviews where submission_id = '${ID.SUB2}'`), "rejected");
  await assert.rejects(as(d, ID.REC, review(ID.SUB1)), /No such submission on your work/);
});

test("admin verifies a recruiter: stored with who and when, audited; un-verifying clears both", { skip }, async () => {
  const d = await db();
  const r = (await as(d, ID.ADMIN, `select public.admin_verify_recruiter('${ID.REC}', true) as r`)).rows[0].r;
  assert.deepEqual(r, { ok: true, company: "Hire Inc", verified: true });
  assert.deepEqual((await d.query(`select verified, verified_by::text, verified_at is not null as at from public.recruiters`)).rows, [{ verified: true, verified_by: ID.ADMIN, at: true }]);
  await as(d, ID.ADMIN, `select public.admin_verify_recruiter('${ID.REC}', false)`);
  assert.deepEqual((await d.query(`select verified, verified_by, verified_at from public.recruiters`)).rows, [{ verified: false, verified_by: null, verified_at: null }]);
  assert.deepEqual((await d.query(`select action from public.audit_logs`)).rows.map((x) => x.action), ["RECRUITER_VERIFIED", "RECRUITER_UNVERIFIED"]);
  await assert.rejects(as(d, ID.ADMIN, `select public.admin_verify_recruiter('00000000-0000-4000-8000-00000000ffff', true)`), /no such recruiter/);
});

test("nobody approves themselves: the recruiter, a company and a student are refused; a direct table write is silently undone (84)", { skip }, async () => {
  const d = await db();
  for (const who of [ID.REC, ID.CO, ID.STU, null]) {
    await assert.rejects(as(d, who, `select public.admin_verify_recruiter('${ID.REC}', true)`), /admins only/);
  }
  await as(d, ID.REC, `update public.recruiters set verified = true, verified_by = '${ID.REC}' where id = '${ID.REC}'`);
  assert.equal(await one(d, `select verified from public.recruiters`), false, "the trigger keeps the old value");
  await as(d, ID.PENDING, `update public.startups set verification_status = 'approved' where user_id = '${ID.PENDING}'`);
  assert.equal(await one(d, `select verification_status from public.startups where user_id = '${ID.PENDING}'`), "pending");
  await assert.rejects(as(d, ID.PENDING, review(ID.SUB1)), /awaiting approval/, "so it still cannot review");
});
