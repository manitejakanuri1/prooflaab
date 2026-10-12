// S39: the squad slice of the schema, for the squad vacancy tests (PGlite and real PostgreSQL alike).
// Tables carry the columns staging has (read-only check, 12 Oct 2026). The FUNCTIONS are not rewritten here: their
// text is cut out of the migrations that created the live versions, so the tests run the code that is really deployed:
//   form_squads            migration/59-tpo-squads-without-trust.sql
//   form_all_colleges      stage 33 (20260901000000)
//   tpo_rebalance_squads   stage 49 (20260921000000)          Manage -> Rebalance
//   assign_to_squad        stage 15 services (20260821020000)  Assign
//   squad_membership_guard stage 24 (20260823000000)          the lock / archive guard
//   notify_squad_placement stage 33                           "You are in <squad>"
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const read = (f) => readFileSync(join(ROOT, f), "utf8");

/** The statement that starts at `start` and ends with the first `end` after it. Refuses if either is missing. */
function cut(file, start, end) {
  const text = read(file);
  const a = text.indexOf(start);
  const b = a < 0 ? -1 : text.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`fixture: '${start}' not found in ${file}`);
  return text.slice(a, b + end.length);
}

export const FORM_SQUADS = cut("migration/59-tpo-squads-without-trust.sql",
  "CREATE OR REPLACE FUNCTION public.form_squads(", "end $function$;");
export const FORM_ALL = cut("supabase/migrations/20260901000000_stage33_phase1_flow_corrections.sql",
  "create or replace function public.form_all_colleges()", "end $fn$;");
export const NOTIFY = cut("supabase/migrations/20260901000000_stage33_phase1_flow_corrections.sql",
  "create or replace function public.notify_squad_placement()", "end $fn$;");
export const REBALANCE = cut("supabase/migrations/20260921000000_stage49_cohorts_and_season_shape.sql",
  "create or replace function public.tpo_rebalance_squads()", "end $function$;");
export const ASSIGN = cut("supabase/migrations/20260821020000_stage15_tpo_services.sql",
  "create or replace function public.assign_to_squad(", "end $fn$;");
export const GUARD = cut("supabase/migrations/20260823000000_stage24_fill_the_four_sections.sql",
  "create or replace function public.squad_membership_guard()", "end $fn$;");

export const M108 = read("migration/108-squad-vacancies-fill-safely.sql");
export const R108 = read("migration/108-rollback-squad-vacancies-fill-safely.sql");
export const M109 = read("migration/109-default-squad-name-themes.sql");

// Fixed ids: two colleges, their current seasons, and an old season of college A.
export const ID = {
  A: "00000000-0000-4000-8000-00000000c0a1", B: "00000000-0000-4000-8000-00000000c0b1",
  SA: "00000000-0000-4000-8000-0000000005a1", SB: "00000000-0000-4000-8000-0000000005b1",
  OLD: "00000000-0000-4000-8000-0000000005a0",
  TPO_A: "00000000-0000-4000-8000-00000000a0a1", TPO_B: "00000000-0000-4000-8000-00000000a0b1",
};

export const FIXTURE = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $f$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.colleges (id uuid primary key, name text);
create table public.college_admins (user_id uuid primary key, college_id uuid);
create table public.seasons (id uuid primary key, college_id uuid, is_current boolean, status text);
create table public.student_profiles (
  id uuid primary key, college_id uuid, full_name text, roll_number text, branch text, cohort text,
  onboarding_status text not null default 'active', total_xp integer default 0);
create table public.task_submissions (student_id uuid, task_id uuid, status text, created_at timestamptz default now());
create table public.squads (
  id uuid primary key default gen_random_uuid(), name text not null, college_id uuid, season_id uuid,
  max_members integer not null default 12, points integer not null default 0, wins integer not null default 0,
  losses integer not null default 0, draws integer not null default 0, rank integer,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz default now(),
  is_locked boolean not null default false, archived_at timestamptz, cohort text, qualified boolean, seed integer);
create table public.squad_members (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  role text, contribution integer, joined_at timestamptz default now(), left_at timestamptz,
  assigned_by uuid, membership_type text);
create unique index squad_members_one_active_squad on public.squad_members (student_id) where left_at is null;
create table public.squad_name_themes (branch text not null, theme text not null, college_id uuid, unique (branch, college_id));
grant select on public.squad_name_themes to authenticated;
create table public.notifications (id bigserial, user_id uuid, audience text, source text, type text, title text, message text, link text);
create table public.audit_log (id bigserial, action text, tbl text, record uuid, old jsonb, new jsonb, college uuid);
create table public.weekly_results (squad_id uuid, week integer, points integer);   -- stands in for scores and matches

create or replace function public.write_audit(_action text, _table text, _record uuid, _old jsonb default null,
  _new jsonb default null, _college uuid default null) returns void language sql security definer
  set search_path = public, pg_temp as
  $f$ insert into public.audit_log (action, tbl, record, old, new, college) values (_action, _table, _record, _old, _new, _college) $f$;
create or replace function public.my_college_id() returns uuid language sql stable security definer
  set search_path = public, pg_temp as $f$ select college_id from public.college_admins where user_id = auth.uid() $f$;
create or replace function public.is_admin() returns boolean language sql stable as $f$ select false $f$;
-- The live ensure_season opens a season when none runs; here every college has one. A college named 'BROKEN' fails,
-- standing in for any error inside one college's formation.
create or replace function public.ensure_season(_college_id uuid) returns uuid language plpgsql
  set search_path = public, pg_temp as $f$
begin
  if exists (select 1 from public.colleges where id = _college_id and name = 'BROKEN') then
    raise exception 'season could not be opened';
  end if;
  return (select id from public.seasons where college_id = _college_id and is_current and status = 'active' limit 1);
end $f$;

${GUARD}
create trigger squad_members_respect_lock before insert on public.squad_members
  for each row execute function public.squad_membership_guard();
${NOTIFY}
create trigger squad_members_notify after insert on public.squad_members
  for each row execute function public.notify_squad_placement();

${FORM_SQUADS}
${FORM_ALL}
${REBALANCE}
${ASSIGN}
create or replace function public.tpo_form_squads() returns jsonb language plpgsql security definer
  set search_path = public, pg_temp as $f$
declare cid uuid := public.my_college_id();
begin
  if cid is null and not public.is_admin() then raise exception 'only a college can form its own squads'; end if;
  return public.form_squads(cid);
end $f$;

revoke all on function public.form_squads(uuid, uuid) from public, anon, authenticated;
grant execute on function public.form_squads(uuid, uuid) to service_role;
revoke all on function public.form_all_colleges() from public, anon, authenticated;
grant execute on function public.form_all_colleges() to service_role;
revoke all on function public.tpo_form_squads() from public, anon;
grant execute on function public.tpo_form_squads() to authenticated;
revoke all on function public.assign_to_squad(uuid, uuid, date) from public, anon;
grant execute on function public.assign_to_squad(uuid, uuid, date) to authenticated;
revoke all on function public.tpo_rebalance_squads() from public, anon;
grant execute on function public.tpo_rebalance_squads() to authenticated;

insert into public.colleges values ('${ID.A}', 'College A'), ('${ID.B}', 'College B');
insert into auth.users values ('${ID.TPO_A}'), ('${ID.TPO_B}');
insert into public.college_admins values ('${ID.TPO_A}', '${ID.A}'), ('${ID.TPO_B}', '${ID.B}');
insert into public.seasons values ('${ID.SA}', '${ID.A}', true, 'active'), ('${ID.SB}', '${ID.B}', true, 'active'),
                                  ('${ID.OLD}', '${ID.A}', false, 'completed');
`;

/** Every helper below is plain SQL text, so the same test bodies run on PGlite and on a real server. */
let seq = 0;
export const uuid = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;

/** n students of one college and section, highest XP first. Returns their ids. */
export function students(college, cohort, n, extra = {}) {
  const ids = [];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const id = uuid(); ids.push(id);
    const status = extra.blocked ? "blocked" : "active";
    rows.push(`('${id}', '${college}', 'S${seq}', 'R${String(seq).padStart(5, "0")}', '${cohort.split("-")[0]}', '${cohort}', '${status}', ${1000 - i})`);
  }
  return { ids, sql: n ? `insert into public.student_profiles (id, college_id, full_name, roll_number, branch, cohort, onboarding_status, total_xp) values ${rows.join(", ")};` : "" };
}

/** One squad with the given members already in it. */
export function squad(college, season, cohort, members, opt = {}) {
  const id = uuid();
  // Members go in before the lock/archive is set, as in real life (a squad is locked after it is filled).
  const ins = members.length
    ? `insert into public.squad_members (squad_id, student_id, joined_at) select '${id}', unnest(array[${members.map((m) => `'${m}'`).join(",")}]::uuid[]), now() - interval '1 day';`
    : "";
  const sql = `insert into public.squads (id, name, college_id, season_id, cohort, max_members, points, wins)
      values ('${id}', '${opt.name ?? cohort + " squad " + seq}', '${college}', '${season}', '${cohort}', ${opt.max ?? 12}, ${opt.points ?? 0}, ${opt.wins ?? 0});
    ${ins}
    update public.squads set is_locked = ${opt.locked ? "true" : "false"}, archived_at = ${opt.archived ? "now()" : "null"} where id = '${id}';`;
  return { id, sql };
}

export const active = (squadId) =>
  `select count(*)::int as n from public.squad_members where squad_id = '${squadId}' and left_at is null`;
export const placedIn = (studentId) =>
  `select squad_id::text as s from public.squad_members where student_id = '${studentId}' and left_at is null`;
