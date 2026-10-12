// Migration 110 (identity lifecycle for every role) on a real PostgreSQL engine (PGlite). OFFLINE, IN-MEMORY.
// No network, no Google, no real account: every id below is a made-up fixture id.
//
//   PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node --test scripts/dev-tools/teja_identity_lifecycle_110.test.mjs
//
// Without PGlite every test is SKIPPED (and the CI gate fails on skipped tests).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const M73 = read("migration/73-suspended-accounts-are-refused.sql");
const M110 = read("migration/110-identity-lifecycle-all-roles.sql");
const R110 = read("migration/110-rollback-identity-lifecycle-all-roles.sql");

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped below */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const ID = {
  STU: "00000000-0000-4000-8000-0000000000a1", STU2: "00000000-0000-4000-8000-0000000000a2",
  TPO: "00000000-0000-4000-8000-0000000000b1", CO: "00000000-0000-4000-8000-0000000000c1",
  REC: "00000000-0000-4000-8000-0000000000c2", ADM: "00000000-0000-4000-8000-0000000000e1",
  ADM2: "00000000-0000-4000-8000-0000000000e2", PROT: "00000000-0000-4000-8000-0000000000f1",
  COLLEGE: "00000000-0000-4000-8000-0000000001c1", OLD: "00000000-0000-4000-8000-0000000000a9",
};
const P = "proj-iso";
const H = (n) => String(n).repeat(64).slice(0, 64);

// A slice of the real schema: the tables and functions 110 reads, with the shapes of 05/11/17/51/55/95/101/102.
const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz default now());
grant usage on schema auth to anon, authenticated, service_role;
create table public.user_roles (user_id uuid primary key, role text not null, has_completed_wizard boolean default true);
create function public.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where role = 'admin'
     and user_id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid) $$;
create table public.colleges (id uuid primary key, status text default 'active', verification_status text default 'approved');
create table public.student_profiles (id uuid primary key, user_id uuid, full_name text, college_id uuid,
  status text default 'active', onboarding_status text, updated_at timestamptz default now());
create table public.account_identities (provider_uid text primary key, user_id uuid not null unique, email text,
  created_at timestamptz not null default now());
create table public.protected_test_accounts (user_id uuid primary key, label text);
create table public.account_sync_missing (student_id uuid primary key references public.student_profiles(id) on delete cascade,
  provider_uid text not null, first_missing_at timestamptz not null default now(), suspended_at timestamptz);
create table public.web_sessions (session_hash text primary key, user_id uuid not null, encrypted_payload text not null,
  created_at timestamptz default now(), last_seen_at timestamptz default now(), expires_at timestamptz not null,
  revoked_at timestamptz);

create function public.resolve_account_uuid(_provider_uid text, _email text default null) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare _uuid uuid;
begin
  begin _uuid := _provider_uid::uuid; return _uuid; exception when invalid_text_representation then null; end;
  select user_id into _uuid from public.account_identities where provider_uid = _provider_uid;
  if _uuid is not null then return _uuid; end if;
  insert into public.account_identities (provider_uid, user_id, email) values (_provider_uid, gen_random_uuid(), _email)
  on conflict (provider_uid) do nothing;
  select user_id into _uuid from public.account_identities where provider_uid = _provider_uid;
  return _uuid;
end $$;
create function public.resolve_account(_provider_uid text, _email text default null, _provider_verified boolean default false)
returns table (user_id uuid, email_confirmed boolean) language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin return query select public.resolve_account_uuid(_provider_uid, _email), _provider_verified; end $$;

-- stand-in for 102's web_login_identity: provisioned and (for students) active
create function public.web_login_identity(_user_id uuid) returns jsonb language plpgsql security definer volatile
set search_path = public, pg_temp as $$
declare r text;
begin
  select role into r from public.user_roles where user_id = _user_id;
  if r is null then return jsonb_build_object('allowed', false, 'reason', 'account_not_provisioned'); end if;
  if r = 'student' and not exists (select 1 from public.student_profiles where id = _user_id and status = 'active') then
    return jsonb_build_object('allowed', false, 'reason', 'student_inactive');
  end if;
  return jsonb_build_object('allowed', true, 'role', r);
end $$;
revoke all on function public.web_login_identity(uuid) from public, anon, authenticated;
grant execute on function public.web_login_identity(uuid) to service_role;
revoke all on function public.resolve_account(text, text, boolean) from public, anon, authenticated;
grant execute on function public.resolve_account(text, text, boolean) to service_role;
alter table public.protected_test_accounts enable row level security;
revoke all on public.protected_test_accounts from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select, update on public.web_sessions to service_role;

insert into public.colleges (id) values ('${ID.COLLEGE}');
insert into public.user_roles (user_id, role) values
  ('${ID.STU}', 'student'), ('${ID.STU2}', 'student'), ('${ID.OLD}', 'student'), ('${ID.TPO}', 'college_admin'),
  ('${ID.CO}', 'startup'), ('${ID.REC}', 'recruiter'), ('${ID.ADM}', 'admin'), ('${ID.ADM2}', 'admin'), ('${ID.PROT}', 'student');
insert into public.student_profiles (id, user_id, full_name, college_id) values
  ('${ID.STU}', '${ID.STU}', 'S One', '${ID.COLLEGE}'), ('${ID.STU2}', '${ID.STU2}', 'S Two', '${ID.COLLEGE}'),
  ('${ID.OLD}', '${ID.OLD}', 'S Old', '${ID.COLLEGE}'), ('${ID.PROT}', '${ID.PROT}', 'Smoke', '${ID.COLLEGE}');
update public.student_profiles set status = 'suspended' where id = '${ID.OLD}';
insert into public.account_identities (provider_uid, user_id) values
  ('g-stu', '${ID.STU}'), ('g-stu2', '${ID.STU2}'), ('g-tpo', '${ID.TPO}'), ('g-co', '${ID.CO}'), ('g-rec', '${ID.REC}'),
  ('g-old', '${ID.OLD}'), ('g-prot', '${ID.PROT}');
insert into public.protected_test_accounts (user_id, label) values ('${ID.PROT}', 'smoke');
-- the pre-110 student ledger: one suspended by the old sync, kept across the upgrade
insert into public.account_sync_missing (student_id, provider_uid, first_missing_at, suspended_at)
  values ('${ID.OLD}', 'g-old', now() - interval '2 hours', now() - interval '1 hour');
insert into public.web_sessions (session_hash, user_id, encrypted_payload, expires_at) values
  ('${H(1)}', '${ID.STU}', repeat('x', 40), now() + interval '1 day'),
  ('${H(2)}', '${ID.STU2}', repeat('x', 40), now() + interval '1 day'),
  ('${H(3)}', '${ID.TPO}', repeat('x', 40), now() + interval '1 day'),
  ('${H(4)}', '${ID.CO}', repeat('x', 40), now() + interval '1 day'),
  ('${H(5)}', '${ID.ADM}', repeat('x', 40), now() + interval '1 day');
`;

async function database(...migrations) {
  const db = new PGlite();
  await db.exec(FIXTURE);
  for (const m of migrations) await db.exec(m);
  return db;
}
async function as(db, role, userId, sql) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId ?? "", role })}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
}
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const svc = (db, sql) => as(db, "service_role", null, sql);
const j = (v) => `'${JSON.stringify(v)}'::jsonb`;
const mark = (db, rows) => svc(db, `select public.identity_sync_apply('${P}', '', ${j(rows)}, '[]', '[]') r`);
const verify = (db, rows) => svc(db, `select public.identity_sync_apply('${P}', '', '[]', ${j(rows)}, '[]') r`);
const recover = (db, rows) => svc(db, `select public.identity_sync_apply('${P}', '', '[]', '[]', ${j(rows)}) r`);
const blocked = (db, id) => one(db, `select public.account_is_suspended('${id}')`);
const live = (db, id) => one(db, `select count(*)::int from public.web_sessions where user_id = '${id}' and revoked_at is null`);

// ------------------------------------------------------------------ apply, re-apply, rollback
test("110 applies, applies again unchanged, carries the old student ledger over", { skip }, async () => {
  const db = await database(M73, M110);
  const rows = await one(db, `select count(*)::int from public.identity_lifecycle`);
  await db.exec(M110);
  assert.equal(await one(db, `select count(*)::int from public.identity_lifecycle`), rows, "re-apply adds nothing");
  const old = (await db.query(`select status, access_blocked, student_suspended, identity_project from public.identity_lifecycle
                                where user_id = '${ID.OLD}'`)).rows;
  assert.deepEqual(old, [{ status: "verified_missing", access_blocked: true, student_suspended: true, identity_project: "prooflab-508214" }]);
  assert.equal(await one(db, `select count(*)::int from pg_proc where proname = 'web_login_identity_base'`), 1);
});

test("110 refuses to run on a database without its prerequisites, and changes nothing", { skip }, async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`);
  await assert.rejects(db.exec(M110), /110 requires/);
  await db.exec("rollback");
  assert.equal(await one(db, `select count(*)::int from pg_class where relname = 'identity_lifecycle'`), 0);
});

test("rollback restores 73/11/102 behaviour, hands suspensions back to account_sync_missing; re-apply works", { skip }, async () => {
  const db = await database(M73, M110);
  await mark(db, [{ user_id: ID.STU, provider_uid: "g-stu", role: "student" }]);
  await verify(db, [{ user_id: ID.STU, provider_uid: "g-stu" }]);
  await db.exec(R110);
  assert.equal(await one(db, `select count(*)::int from pg_proc where proname = 'web_login_identity_base'`), 0);
  assert.equal((await one(db, `select public.web_login_identity('${ID.CO}')`)).allowed, true);
  assert.ok(await one(db, `select suspended_at is not null from public.account_sync_missing where student_id = '${ID.STU}'`),
    "the student the ledger suspended is known to the old sync, so it can restore them");
  assert.equal(await one(db, `select count(*)::int from public.identity_lifecycle`) > 0, true, "audit table kept");
  await db.exec(M110);
  assert.equal(await blocked(db, ID.STU), true);
});

// ------------------------------------------------------------------ browser roles
test("browser roles cannot read or change the ledger or run any server-only function", { skip }, async () => {
  const db = await database(M73, M110);
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(as(db, role, ID.STU, `select * from public.identity_lifecycle`), /permission denied/);
    await assert.rejects(as(db, role, ID.STU, `insert into public.identity_lifecycle (event_key, user_id, identity_project,
      provider_uid, direction, status, actor) values ('xxxxxxxxxx', '${ID.STU}', 'p', 'u', 'console', 'recovered', 'me')`), /permission denied/);
    for (const call of [`public.identity_sync_accounts('${P}', '')`,
      `public.identity_sync_apply('${P}', '', '[]', '[]', ${j([{ user_id: ID.ADM, provider_uid: ID.ADM }])})`,
      `public.identity_request_deletion('${ID.CO}', '${ID.CO}', 'DELETE', '${P}', '')`,
      `public.identity_record_student_removals('[]', 'x', '${P}', '')`, `public.identity_due_deletions('${P}', '', 10)`,
      `public.identity_attempt_result(1, true, null)`, `public.identity_lifecycle_health()`,
      `public.identity_access_blocked('${ID.STU}')`, `public.web_login_identity('${ID.STU}')`,
      `public.web_login_identity_base('${ID.STU}')`]) {
      await assert.rejects(as(db, role, ID.ADM, `select ${call}`), /permission denied/, `${role}: ${call}`);
    }
  }
  await assert.rejects(as(db, "anon", null, `select public.account_access_ok()`), /permission denied/);
  await assert.rejects(svc(db, `delete from public.identity_lifecycle`), /permission denied/, "audit rows are never deleted by the API");
});

test("account_access_ok answers for the ticket's own subject only - no argument to impersonate with", { skip }, async () => {
  const db = await database(M73, M110);
  assert.equal(await one(db, `select count(*)::int from pg_proc where proname = 'account_access_ok' and pronargs = 0`), 1);
  assert.equal((await as(db, "authenticated", ID.CO, `select public.account_access_ok() ok`)).rows[0].ok, true);
  await svc(db, `select public.identity_request_deletion('${ID.CO}', '${ID.ADM}', null, '${P}', '')`);
  assert.equal((await as(db, "authenticated", ID.CO, `select public.account_access_ok() ok`)).rows[0].ok, false);
  assert.equal((await as(db, "authenticated", ID.REC, `select public.account_access_ok() ok`)).rows[0].ok, true);
  assert.equal((await as(db, "authenticated", "not-a-uuid", `select public.account_access_ok() ok`)).rows[0].ok, false);
});

test("admin status report: administrators only, login ids shown as 4 characters", { skip }, async () => {
  const db = await database(M73, M110);
  await assert.rejects(as(db, "authenticated", ID.CO, `select * from public.admin_identity_lifecycle(10)`), /administrators only/);
  const r = (await as(db, "authenticated", ID.ADM, `select * from public.admin_identity_lifecycle(10)`)).rows;
  assert.ok(r.length >= 1 && r.every((x) => x.provider_uid_tail.length <= 4));
});

// ------------------------------------------------------------------ Google Console -> app, every role
for (const [name, id, uid] of [["student", ID.STU, "g-stu"], ["college_admin", ID.TPO, "g-tpo"], ["startup (company)", ID.CO, "g-co"],
                               ["recruiter", ID.REC, "g-rec"], ["admin", ID.ADM, ID.ADM]]) {
  test(`Console delete, ${name}: observed -> verified cuts access everywhere; same id back restores it`, { skip }, async () => {
    const db = await database(M73, M110);
    const role = name.split(" ")[0];
    await mark(db, [{ user_id: id, provider_uid: uid, role }]);
    assert.equal(await blocked(db, id), false, "one sighting cuts nothing");
    const before = await live(db, ID.STU2);
    const r = (await verify(db, [{ user_id: id, provider_uid: uid, reason: "login deleted" }])).rows[0].r;
    assert.equal(r.verified, 1);
    // every gate refuses: API hook (old tickets), functions (same function), BFF login rule, bridge, files
    assert.equal(await blocked(db, id), true);
    assert.equal((await one(db, `select public.web_login_identity('${id}')`)).reason, "identity_missing");
    await assert.rejects(db.query(`select * from public.resolve_account('${uid}', null, false)`), /no longer active/);
    await assert.rejects(as(db, "authenticated", id, `select public.refuse_suspended()`), /suspended/);
    assert.equal((await as(db, "authenticated", id, `select public.account_access_ok() ok`)).rows[0].ok, false);
    assert.equal(await live(db, id), 0, "its own sessions are revoked at once");
    // nobody else is touched: another student, the college
    assert.equal(await live(db, ID.STU2), before);
    assert.equal(await blocked(db, ID.STU2), false);
    assert.equal(await one(db, `select status from public.colleges where id = '${ID.COLLEGE}'`), "active");
    if (role === "student") assert.equal(await one(db, `select status from public.student_profiles where id = '${id}'`), "suspended");
    // the same login id is back: everything returns
    const back = (await recover(db, [{ user_id: id, provider_uid: uid }])).rows[0].r;
    assert.equal(back.recovered, 1);
    assert.equal(await blocked(db, id), false);
    assert.equal((await one(db, `select public.web_login_identity('${id}')`)).allowed, true);
    if (role === "student") assert.equal(await one(db, `select status from public.student_profiles where id = '${id}'`), "active");
    assert.equal(await one(db, `select count(*)::int from public.student_profiles`), 4, "nothing deleted");
  });
}

test("duplicate and out-of-order sync events: one open row; verify before mark does nothing", { skip }, async () => {
  const db = await database(M73, M110);
  assert.equal((await verify(db, [{ user_id: ID.CO, provider_uid: "g-co" }])).rows[0].r.skipped, 1);
  assert.equal(await blocked(db, ID.CO), false);
  for (let i = 0; i < 3; i++) await mark(db, [{ user_id: ID.CO, provider_uid: "g-co", role: "startup" }]);
  assert.equal(await one(db, `select count(*)::int from public.identity_lifecycle where user_id = '${ID.CO}'`), 1);
  await verify(db, [{ user_id: ID.CO, provider_uid: "g-co" }]);
  assert.equal((await verify(db, [{ user_id: ID.CO, provider_uid: "g-co" }])).rows[0].r.verified, 0, "verified once");
});

test("wrong identity project, wrong tenant or wrong login id: skipped, never guessed", { skip }, async () => {
  const db = await database(M73, M110);
  await mark(db, [{ user_id: ID.CO, provider_uid: "g-co", role: "startup" }]);
  const other = (q) => svc(db, q);
  assert.equal((await other(`select public.identity_sync_apply('prooflab-508214', '', '[]', ${j([{ user_id: ID.CO, provider_uid: "g-co" }])}, '[]') r`)).rows[0].r.skipped, 1);
  assert.equal((await other(`select public.identity_sync_apply('${P}', 'tenant-x', '[]', ${j([{ user_id: ID.CO, provider_uid: "g-co" }])}, '[]') r`)).rows[0].r.skipped, 1);
  assert.equal((await verify(db, [{ user_id: ID.CO, provider_uid: "g-OTHER" }])).rows[0].r.skipped, 1);
  assert.equal((await verify(db, [{ user_id: ID.REC, provider_uid: "g-co" }])).rows[0].r.skipped, 1);
  assert.equal(await blocked(db, ID.CO), false);
  const rows = (await svc(db, `select user_id, ledger_status from public.identity_sync_accounts('prooflab-508214', '') where user_id = '${ID.CO}'`)).rows;
  assert.equal(rows[0].ledger_status, null, "another scope does not see this scope's row");
});

test("a different login id with the same email is a new identity: the old account stays cut off", { skip }, async () => {
  const db = await database(M73, M110);
  await mark(db, [{ user_id: ID.CO, provider_uid: "g-co", role: "startup" }]);
  await verify(db, [{ user_id: ID.CO, provider_uid: "g-co" }]);
  const fresh = await one(db, `select user_id from public.resolve_account('g-co-NEW', 'co@x.test', true)`);
  assert.notEqual(fresh, ID.CO);
  assert.equal((await recover(db, [{ user_id: ID.CO, provider_uid: "g-co-NEW" }])).rows[0].r.recovered, 0);
  assert.equal(await blocked(db, ID.CO), true);
});

test("protected test accounts are never cut: skipped by the sync, refused by the table itself", { skip }, async () => {
  const db = await database(M73, M110);
  assert.equal((await mark(db, [{ user_id: ID.PROT, provider_uid: "g-prot", role: "student" }])).rows[0].r.skipped, 1);
  await assert.rejects(db.query(`insert into public.identity_lifecycle (event_key, user_id, identity_project, provider_uid,
    direction, status, access_blocked, actor) values ('manual-try-1', '${ID.PROT}', '${P}', 'g-prot', 'console', 'verified_missing', true, 'x')`),
    /protected test fixture/);
  assert.equal(await blocked(db, ID.PROT), false);
});

test("a student suspended for another reason is not 'restored' by the sync", { skip }, async () => {
  const db = await database(M73, M110);
  await db.exec(`update public.student_profiles set status = 'suspended' where id = '${ID.STU2}'`);
  await mark(db, [{ user_id: ID.STU2, provider_uid: "g-stu2", role: "student" }]);
  await verify(db, [{ user_id: ID.STU2, provider_uid: "g-stu2" }]);
  assert.equal(await one(db, `select student_suspended from public.identity_lifecycle where user_id = '${ID.STU2}'`), false);
  await recover(db, [{ user_id: ID.STU2, provider_uid: "g-stu2" }]);
  assert.equal(await one(db, `select status from public.student_profiles where id = '${ID.STU2}'`), "suspended");
});

// ------------------------------------------------------------------ app -> Google (deletion outbox)
test("who may delete whom (non-students)", { skip }, async () => {
  const db = await database(M73, M110);
  const req = (target, by, confirm) => svc(db, `select public.identity_request_deletion('${target}', '${by}', ${confirm ? `'${confirm}'` : "null"}, '${P}', '') r`);
  await assert.rejects(req(ID.CO, ID.CO, null), /may not delete/, "self without typing DELETE");
  await assert.rejects(req(ID.CO, ID.REC, "DELETE"), /may not delete/, "a company cannot delete another");
  await assert.rejects(req(ID.CO, ID.TPO, "DELETE"), /may not delete/, "a college cannot delete a company");
  await assert.rejects(req(ID.TPO, ID.STU, "DELETE"), /may not delete/, "a student cannot delete their college");
  await assert.rejects(req(ID.STU, ID.ADM, null), /remove_students/, "students go through remove_students");
  await assert.rejects(req(ID.PROT, ID.ADM, null), /students are removed|protected/);
  await assert.rejects(req("00000000-0000-4000-8000-00000000dead", ID.ADM, null), /no such account/);
  const r = (await req(ID.CO, ID.CO, "DELETE")).rows[0].r;
  assert.equal(r.status, "requested");
  assert.equal(r.already, false);
  assert.equal(await blocked(db, ID.CO), true, "access is cut the moment the request is accepted");
  assert.equal(await live(db, ID.CO), 0);
  assert.equal((await req(ID.CO, ID.CO, "DELETE")).rows[0].r.already, true, "idempotent");
  assert.equal(await one(db, `select count(*)::int from public.identity_lifecycle where user_id = '${ID.CO}'`), 1);
  // records kept (retention): the company's role row is still there; nothing else changed
  assert.equal(await one(db, `select role from public.user_roles where user_id = '${ID.CO}'`), "startup");
  assert.equal(await blocked(db, ID.REC), false);
});

test("the last active administrator cannot be deleted; a cut-off admin cannot delete anyone", { skip }, async () => {
  const db = await database(M73, M110);
  const req = (target, by, confirm) => svc(db, `select public.identity_request_deletion('${target}', '${by}', ${confirm ? `'${confirm}'` : "null"}, '${P}', '') r`);
  await req(ID.ADM2, ID.ADM, null);
  await assert.rejects(req(ID.ADM, ID.ADM, "DELETE"), /last active administrator/);
  await assert.rejects(req(ID.REC, ID.ADM2, null), /may not delete/, "the deleted admin has no power left");
  assert.equal(await blocked(db, ID.ADM), false);
});

test("outbox: scoped, least-tried first, backoff, failed after 8 tries, completed only on a confirmed delete", { skip }, async () => {
  const db = await database(M73, M110);
  const rows = [{ student_id: ID.STU, provider_uid: "g-stu" }, { student_id: ID.STU2, provider_uid: null }];
  const rec = (await svc(db, `select * from public.identity_record_student_removals(${j(rows)}, 'college:${ID.TPO}', '${P}', '')`)).rows;
  assert.deepEqual(rec.map((r) => r.status).sort(), ["failed", "pending"], "no login id on record -> needs a person");
  await svc(db, `select * from public.identity_record_student_removals(${j(rows)}, 'college:${ID.TPO}', '${P}', '')`);
  assert.equal(await one(db, `select count(*)::int from public.identity_lifecycle where direction = 'app'`), 2, "idempotent");
  assert.equal((await svc(db, `select * from public.identity_due_deletions('prooflab-508214', '', 10)`)).rows.length, 0, "other scope sees nothing");
  const due = (await svc(db, `select * from public.identity_due_deletions('${P}', '', 10)`)).rows;
  assert.equal(due.length, 1);
  const id = due[0].id;
  assert.equal(await one(db, `select public.identity_attempt_result(${id}, false, 'HTTP 503')`), "pending");
  assert.equal((await svc(db, `select * from public.identity_due_deletions('${P}', '', 10)`)).rows.length, 0, "backing off");
  const gap = await one(db, `select extract(epoch from next_attempt_at - now())::int from public.identity_lifecycle where id = ${id}`);
  assert.ok(gap >= 55 && gap <= 65, `first retry about a minute later (${gap}s)`);
  for (let i = 0; i < 6; i++) await db.query(`select public.identity_attempt_result(${id}, false, 'HTTP 429')`);
  const capped = await one(db, `select extract(epoch from next_attempt_at - now())::int from public.identity_lifecycle where id = ${id}`);
  assert.ok(capped <= 6 * 3600 + 5, "backoff capped at 6 hours");
  assert.equal(await one(db, `select public.identity_attempt_result(${id}, false, 'HTTP 500')`), "failed");
  assert.equal(await one(db, `select public.identity_attempt_result(${id}, true, null)`), null, "a failed row is not silently completed");
  assert.equal(await blocked(db, ID.STU), true, "access stays cut while pending or failed");
  const h = await one(db, `select public.identity_lifecycle_health()`);
  assert.equal(h.failed, 2);
});

test("outbox: a confirmed delete completes once; a second (duplicate) result changes nothing", { skip }, async () => {
  const db = await database(M73, M110);
  const r = (await svc(db, `select public.identity_request_deletion('${ID.REC}', '${ID.ADM}', null, '${P}', '') r`)).rows[0].r;
  assert.equal(await one(db, `select public.identity_attempt_result(${r.id}, true, null)`), "completed");
  assert.equal(await one(db, `select public.identity_attempt_result(${r.id}, false, 'late duplicate')`), null);
  assert.equal(await one(db, `select status from public.identity_lifecycle where id = ${r.id}`), "completed");
  assert.equal(await blocked(db, ID.REC), true, "a deleted account stays cut off");
  const sync = (await svc(db, `select in_app_deletion from public.identity_sync_accounts('${P}', '') where user_id = '${ID.REC}'`)).rows[0];
  assert.equal(sync.in_app_deletion, true, "the sync leaves it to the outbox");
});

// ------------------------------------------------------------------ only genuinely linked logins are reconciled
test("linked flag: mapped logins are linked; an account with no login link (synthetic) is not", { skip }, async () => {
  const db = await database(M73, M110);
  await db.exec(`insert into public.user_roles (user_id, role) select gen_random_uuid(), 'student' from generate_series(1, 50)`);
  const rows = (await svc(db, `select user_id, linked from public.identity_sync_accounts('${P}', '')`)).rows;
  const by = Object.fromEntries(rows.map((r) => [r.user_id, r.linked]));
  assert.equal(by[ID.CO], true);
  assert.equal(by[ID.ADM], false, "uuid-named admin has no mapping row yet");
  assert.equal(rows.filter((r) => !r.linked).length, 52, "50 synthetic + 2 uuid-named admins");
});

test("identity_link_present links only uuid-named logins of existing accounts, never overwrites a mapping", { skip }, async () => {
  const db = await database(M73, M110);
  const n = await one(db, `select public.identity_link_present(${j([
    { user_id: ID.ADM, provider_uid: ID.ADM },                       // uuid-named, present: linked
    { user_id: ID.CO, provider_uid: ID.CO },                         // already mapped to g-co: untouched
    { user_id: ID.ADM2, provider_uid: "someone-else" },              // id is not its own: skipped
    { user_id: "00000000-0000-4000-8000-00000000dead", provider_uid: "00000000-0000-4000-8000-00000000dead" }, // no account
  ])})`);
  assert.equal(n, 1);
  assert.equal(await one(db, `select provider_uid from public.account_identities where user_id = '${ID.CO}'`), "g-co");
  assert.equal(await one(db, `select count(*)::int from public.account_identities where user_id = '${ID.ADM}'`), 1);
  await assert.rejects(as(db, "authenticated", ID.ADM, `select public.identity_link_present('[]')`), /permission denied/);
});

test("a uuid-named login becomes linked when it signs in (resolve_account); a cut-off one does not", { skip }, async () => {
  const db = await database(M73, M110);
  assert.equal(await one(db, `select user_id from public.resolve_account('${ID.ADM2}', 'a2@x.test', true)`), ID.ADM2);
  assert.equal(await one(db, `select count(*)::int from public.account_identities where user_id = '${ID.ADM2}'`), 1);
  await mark(db, [{ user_id: ID.ADM, provider_uid: ID.ADM, role: "admin" }]);
  await verify(db, [{ user_id: ID.ADM, provider_uid: ID.ADM }]);
  await assert.rejects(db.query(`select * from public.resolve_account('${ID.ADM}', null, false)`), /no longer active/);
  assert.equal(await one(db, `select count(*)::int from public.account_identities where user_id = '${ID.ADM}'`), 0);
});
