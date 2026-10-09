// S30: real-PostgreSQL harness for the authorization repair. OFFLINE, IN-MEMORY, THROWAWAY.
//
// Uses PGlite (PostgreSQL 16 compiled to WebAssembly, runs inside this Node process). It is NOT a project database:
// nothing is read from or written to staging or production, and it disappears when the process ends.
// PGlite is not a repository dependency. Point PGLITE_MODULE at an install of @electric-sql/pglite (file URL or name).
//
// What it builds:
//   1. A minimal fixture: roles anon / authenticated / service_role, auth.uid() / auth.role() reading the same
//      request.jwt.claims setting PostgREST sets, and the tables these rules touch (only the columns they use).
//   2. The BEFORE state, taken VERBATIM from the repository by sidhu_s30_policy_model.mjs (all migrations except the
//      one under test): function bodies, RLS policies and triggers of the affected tables, and migration 01's
//      blanket grants with migration 80's revoke on record_task_submission.
//   3. Optionally the AFTER state: migration/103 applied exactly as written in the file.
// Each scenario runs as a real role (SET ROLE) with real claims, so RLS, WITH CHECK after BEFORE triggers,
// alphabetical trigger order, SECURITY DEFINER bypass and current_user are PostgreSQL's own behaviour.
// Limits: the fixture is not the full production schema (the restored dump is not in the repository), and only the
// policies / triggers of the tables listed in TABLES are loaded.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyOrder, buildModel } from "./sidhu_s30_policy_model.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// S30_MIGRATION_FILE overrides the file applied for the AFTER state (used only by the mutation check).
export const MIGRATION_103 = process.env.S30_MIGRATION_FILE ?? join(ROOT, "migration/103-task-provenance-and-authz-repair.sql");

export const ID = {
  SA: "00000000-0000-4000-8000-0000000000a1", SB: "00000000-0000-4000-8000-0000000000a2", SC: "00000000-0000-4000-8000-0000000000a3",
  TPO1: "00000000-0000-4000-8000-0000000000c1", TPO2: "00000000-0000-4000-8000-0000000000c2", TPOP: "00000000-0000-4000-8000-0000000000c3",
  CO1: "00000000-0000-4000-8000-0000000000d1", CO2: "00000000-0000-4000-8000-0000000000d2", ADM: "00000000-0000-4000-8000-0000000000e1",
  C1: "00000000-0000-4000-8000-0000000001c1", C2: "00000000-0000-4000-8000-0000000001c2", C3: "00000000-0000-4000-8000-0000000001c3",
  GENERIC: "00000000-0000-4000-8000-00000000f001", R1: "00000000-0000-4000-8000-00000000f002",
  SANDBOX: "00000000-0000-4000-8000-00000000f003", CODING: "00000000-0000-4000-8000-00000000d004",
  DAILY: "00000000-0000-4000-8000-00000000d001", SPONSORED: "00000000-0000-4000-8000-00000000d002",
  ASSIGNED: "00000000-0000-4000-8000-00000000d003", ADMIN_TPL: "00000000-0000-4000-8000-00000000e101",
  NEWUSER: "00000000-0000-4000-8000-0000000000f9",   // signed in, but has no role row yet
};

const TABLES = ["tasks", "task_assignments", "task_templates", "audit_logs", "job_opportunities", "user_roles", "student_profiles", "colleges", "task_rubric_config"];
const FUNCTIONS = ["has_role", "is_admin", "my_college_id", "college_owns_student", "my_approved_college_ids", "protect_columns",
  "task_default_checker", "tasks_clamp_student_insert", "record_task_submission", "set_updated_at", "touch_updated_at"];

const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create type public.app_role as enum ('admin', 'student', 'college_admin', 'startup', 'recruiter');
create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null unique, role public.app_role not null, has_completed_wizard boolean default true);
create table public.colleges (id uuid primary key, user_id uuid, name text, status text default 'active', verification_status text default 'pending');
create table public.student_profiles (id uuid primary key, user_id uuid unique, college_id uuid, full_name text, status text default 'active',
  cohort text, total_xp integer default 0, source text, profile_completed boolean, onboarding_status text, calibration_completed boolean,
  first_task_completed boolean, invited_at timestamptz, onboarded_at timestamptz, roll_number text, updated_at timestamptz default now());
create table public.task_rubric_config (id uuid primary key, pass_threshold integer default 60, is_generic_fallback boolean not null default false, origin text);
create table public.task_sandbox_config (id uuid primary key, pass_threshold integer default 100);
create table public.levels (id uuid primary key, skill text);
create table public.tasks (id uuid primary key default gen_random_uuid(), student_id uuid, title text, description text, category text,
  status text default 'pending', visibility text default 'private', source text, created_by_type text, created_by_admin_id uuid,
  created_by_college_id uuid, created_by_startup_id uuid, approved_by_admin boolean default false, is_ai_generated boolean default false,
  is_paid boolean, ai_metadata jsonb, required_skills text[], difficulty text, duration_days integer, due_date timestamptz,
  upload_deadline timestamptz, posted_at timestamptz, started_at timestamptz, completed_at timestamptz, level_id uuid,
  roadmap_scorecard_id uuid, roadmap_stage_index integer, suggested_xp integer, xp integer, xp_reward integer default 0,
  created_at timestamptz default now(), updated_at timestamptz default now(), lot_number integer, estimate_minutes integer,
  code_sample text, source_jd text, lot_date date, lot_category text, sponsored_by uuid, sponsor_criteria text,
  sandbox_config_id uuid, is_sandbox_task boolean default false, rubric_config_id uuid, source_content_id uuid, grading_type text,
  lot_candidate_id uuid, lot_selection jsonb);
create unique index tasks_one_lot_per_day on public.tasks (student_id, lot_date) where lot_date is not null;
create table public.task_assignments (id uuid primary key default gen_random_uuid(), task_id uuid, student_id uuid, status text default 'assigned',
  completed_at timestamptz, submitted_at timestamptz, updated_at timestamptz default now());
create table public.task_submissions (id uuid primary key default gen_random_uuid(), task_id uuid, student_id uuid, sandbox_config_id uuid,
  rubric_config_id uuid, language text, code text, sandbox_score integer, passed_count integer, total_count integer, status text,
  details jsonb, runner text, duration_ms integer, rubric_scores jsonb, flags text[], xp_awarded integer default 0, created_at timestamptz default now());
create unique index task_submissions_one_pass on public.task_submissions (task_id, student_id) where status = 'passed';
create table public.xp_logs (id uuid primary key default gen_random_uuid(), student_id uuid, xp_points integer, source text);
create unique index xp_logs_task_once on public.xp_logs (student_id, source) where source like 'task:%';
create table public.task_templates (id uuid primary key default gen_random_uuid(), title text, description text, branch text, skills text[],
  difficulty text, xp_reward integer, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(), user_id uuid, action text, table_name text, record_id uuid,
  old_values jsonb, new_values jsonb, college_id uuid, created_at timestamptz default now());
create table public.job_opportunities (id uuid primary key default gen_random_uuid(), role text, company_name text, status text default 'pending',
  created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.resume_scorecards (id uuid primary key default gen_random_uuid(), student_id uuid, resume_quality_score integer,
  ats_match_score integer, skill_proof_score integer, project_proof_score integer, reasoning_score integer, coding_score integer,
  interview_readiness_score integer, skill_gap jsonb, roadmap jsonb, created_at timestamptz default now());
create table public.student_portfolios (student_id uuid primary key, is_public boolean default false);
create table public.llm_usage (id uuid primary key default gen_random_uuid(), student_id uuid, feature text, provider text,
  prompt_tokens integer, completion_tokens integer, total_tokens integer, created_at timestamptz default now());
create table public.student_contact (student_id uuid primary key, email text);
-- Stubs for bookkeeping functions record_task_submission calls (they do not affect authorization).
create function public.log_activity(uuid, text, text, uuid, jsonb) returns void language sql security definer as $$ select $$;
create function public.record_activity(uuid, text) returns void language sql security definer as $$ select $$;
create function public.record_topic_attempt(uuid, text, text, uuid, text) returns void language sql security definer as $$ select $$;
`;

function viewsFrom(files) {
  // The two views, verbatim from their migrations.
  const out = [];
  for (const [name, file] of [["public_resume_scorecards", "supabase/migrations/20260822020000_stage23_squads_podium_scorecard.sql"], ["llm_usage_by_student", "supabase/migrations/20260821000000_stage14_admin_dashboard.sql"]]) {
    const sql = readFileSync(join(ROOT, file), "utf8");
    const i = sql.search(new RegExp(`create view public\\.${name}`, "i"));
    out.push(sql.slice(i, sql.indexOf(";", i) + 1));
  }
  return out.join("\n");
}

const q = (s) => `"${s.replace(/"/g, '""')}"`;
/** DDL for the BEFORE state of the selected tables, generated from the replayed model. Returns { sql, skipped }. */
export function beforeStateSql(files) {
  const m = buildModel({ root: ROOT, files });
  const parts = [], skipped = [];
  // LF line endings, as the files were applied on staging. A Windows checkout may hold CRLF, and in-place patches
  // (migrations 91, 93, 103) anchor on LF.
  for (const f of FUNCTIONS) { const fn = m.functions.get(f); if (fn) parts.push(fn.sql.replace(/\r\n/g, "\n").trim().replace(/;?\s*$/, ";")); else skipped.push(`function ${f}`); }
  for (const t of TABLES) {
    const tb = m.tables.get(t);
    if (tb.rls) parts.push(`alter table public.${t} enable row level security;`);
    for (const p of tb.policies.values()) {
      parts.push(`create policy ${q(p.name)} on public.${t} as ${p.permissive ? "permissive" : "restrictive"} for ${p.cmd} to ${p.roles.join(", ")}`
        + `${p.using ? ` using (${p.using})` : ""}${p.check ? ` with check (${p.check})` : ""};`);
    }
    for (const tr of tb.triggers.values()) {
      if (!FUNCTIONS.includes(tr.fn)) { skipped.push(`trigger ${t}.${tr.name} -> ${tr.fn}`); continue; }
      const args = tr.args.length ? tr.args.map((a) => `'${a}'`).join(", ") : "";
      parts.push(`create trigger ${q(tr.name)} ${tr.when} ${tr.events} on public.${t} for each row execute function public.${tr.fn}(${args});`);
    }
  }
  return { sql: parts.join("\n"), skipped };
}

export async function makeDb({ fixed, preSelfClaim = false } = {}) {
  const mod = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
  const db = new mod.PGlite();
  await db.exec("set check_function_bodies = off;");
  await db.exec(FIXTURE);
  const files = applyOrder(ROOT).filter((f) => !/[\\/]migration[\\/]103-/.test(f));
  const before = beforeStateSql(files);
  await db.exec(before.sql);
  await db.exec(viewsFrom());   // after the functions: llm_usage_by_student calls is_admin()
  // Migration 01's blanket grants, then migration 80's revoke of record_task_submission (both from source).
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant execute on all functions in schema public to anon, authenticated, service_role;
    revoke all on function public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[]) from public, anon, authenticated;
    grant execute on function public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[]) to service_role;`);
  // In-place patches of record_task_submission that live databases carry (migrations 91 and 93 patch it inside DO
  // blocks). Default "91" = live staging on 9 Oct 2026 (md5 f0930e15b377a178042ef468d3524fea, matched by this harness).
  for (const n of (process.env.S30_LIVE_PATCHES ?? "91").split(",").map((x) => x.trim()).filter(Boolean)) {
    const file = { "91": "migration/91-coding-pass-needs-every-test.sql", "93": "migration/93-coding-pass-counts-hidden-summary.sql" }[n];
    if (!file) throw new Error(`unknown live patch ${n}`);
    await db.exec(readFileSync(join(ROOT, file), "utf8").replace(/\r\n/g, "\n"));
  }
  if (preSelfClaim) {
    // The state of an environment where migration 100 never ran (stage47's policy).
    await db.exec(`create policy user_roles_self_claim on public.user_roles for insert to authenticated
      with check (user_id = (select auth.uid()) and role = any (array['student'::app_role, 'college_admin'::app_role, 'startup'::app_role, 'recruiter'::app_role]));`);
  }
  await seed(db);
  if (fixed) await db.exec(readFileSync(MIGRATION_103, "utf8"));
  return { db, skipped: before.skipped };
}

async function seed(db) {
  const roles = [["SA", "student"], ["SB", "student"], ["SC", "student"], ["TPO1", "college_admin"], ["TPO2", "college_admin"], ["TPOP", "college_admin"], ["CO1", "startup"], ["CO2", "startup"], ["ADM", "admin"]];
  await db.exec(`
    insert into public.user_roles (user_id, role) values ${roles.map(([k, r]) => `('${ID[k]}', '${r}')`).join(", ")};
    insert into public.colleges (id, user_id, name, status, verification_status) values
      ('${ID.C1}', '${ID.TPO1}', 'College One', 'active', 'approved'), ('${ID.C2}', '${ID.TPO2}', 'College Two', 'active', 'approved'),
      ('${ID.C3}', '${ID.TPOP}', 'Pending College', 'active', 'pending');
    insert into public.student_profiles (id, user_id, college_id, full_name, cohort) values
      ('${ID.SA}', '${ID.SA}', '${ID.C1}', 'Student A', 'A'), ('${ID.SB}', '${ID.SB}', '${ID.C1}', 'Student B', 'A'),
      ('${ID.SC}', '${ID.SC}', '${ID.C2}', 'Student C', 'A'), ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a4', '${ID.C3}', 'Student D', 'A');
    insert into public.task_rubric_config (id, pass_threshold, is_generic_fallback, origin) values
      ('${ID.GENERIC}', 60, true, 'fallback'), ('${ID.R1}', 60, false, 'ai');
    -- Server-made tasks (as the definer functions create them): a daily Lot, a company-sponsored Lot, an admin task assigned to SB.
    insert into public.tasks (id, student_id, title, status, created_by_type, source, rubric_config_id, lot_date) values
      ('${ID.DAILY}', '${ID.SA}', 'Daily Lot: count failed logins', 'pending', 'system', 'daily_lot', '${ID.R1}', current_date);
    insert into public.tasks (id, student_id, title, status, created_by_type, source, rubric_config_id, sponsored_by, lot_date) values
      ('${ID.SPONSORED}', '${ID.SA}', 'Sponsored: fix the cache', 'pending', 'recruiter', 'sponsored', '${ID.R1}', '${ID.CO1}', current_date + 1);
    insert into public.tasks (id, student_id, title, status, created_by_type, rubric_config_id) values
      ('${ID.ASSIGNED}', '${ID.ADM}', 'Assigned to SB', 'pending', 'admin', '${ID.R1}');
    insert into public.task_assignments (task_id, student_id) values ('${ID.ASSIGNED}', '${ID.SB}');
    insert into public.task_sandbox_config (id, pass_threshold) values ('${ID.SANDBOX}', 80);
    insert into public.tasks (id, student_id, title, status, created_by_type, source, sandbox_config_id) values
      ('${ID.CODING}', '${ID.SC}', 'Coding Lot', 'pending', 'system', 'daily_lot', '${ID.SANDBOX}');
    insert into public.task_templates (id, title, description, created_by) values ('${ID.ADMIN_TPL}', 'Admin template', 'shared', '${ID.ADM}');
    insert into public.resume_scorecards (student_id, resume_quality_score) values ('${ID.SA}', 77);
    insert into public.student_portfolios (student_id, is_public) values ('${ID.SA}', true);
  `);
}

/** Runs `sql` as `who` (a key of ID, 'ANON' or 'SERVICE'). Returns { ok, rows, error }. */
export async function as(db, who, sql, params = []) {
  const claims = who === "ANON" ? { role: "anon" } : who === "SERVICE" ? { role: "service_role" } : { sub: ID[who], role: "authenticated" };
  const role = who === "ANON" ? "anon" : who === "SERVICE" ? "service_role" : "authenticated";
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, count: r.affectedRows ?? r.rows.length }; }
  catch (e) { return { ok: false, rows: [], error: String(e.message ?? e) }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}
/** Reads as the superuser (no RLS), for checking what actually got stored. */
export const peek = async (db, sql) => (await db.query(sql)).rows;

export const recordSubmission = (task, student, rubric, score = 90) =>
  `select public.record_task_submission('${student}'::uuid, '${task}'::uuid, null::uuid, null::text, null::text, null::int, null::int, ${score}, '[]'::jsonb, 'test', 1, '${rubric}'::uuid, null::jsonb, '{}'::text[]) as r`;

/** A coding submission: `passed` of `total` tests, one details row per test (the shape migration 91 requires). */
export const recordCoding = (task, student, sandbox, passed, total, score) => {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `t${i}`, passed: i < passed }));
  return `select public.record_task_submission('${student}'::uuid, '${task}'::uuid, '${sandbox}'::uuid, 'python'::text, 'print(1)'::text, ${passed}, ${total}, ${score}, '${JSON.stringify(rows)}'::jsonb, 'test', 1, null::uuid, null::jsonb, '{}'::text[]) as r`;
};
