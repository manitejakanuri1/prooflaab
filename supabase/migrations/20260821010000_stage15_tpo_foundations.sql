-- ============================================================================
-- Stage 15 — foundations for the TPO dashboard.
--
-- The backend specification lists twenty-two tables. Eight already exist and
-- fit, three exist partly, eleven are missing — but only four of those eleven
-- are worth building now. The rest are either optional caches the spec itself
-- defers, or things this schema can already derive:
--
--   reserve_pool           a reserve is a student with no active squad row
--   season_rounds          only carries the label "Round 6"
--   match_results          points already live on the match row
--   student_daily_metrics  a cache, and there is nothing yet to cache
--   squad_metrics          squads already carries points, wins, losses, rank
--   student_onboarding     one row per student with no history, so five
--                          columns on student_profiles beat a second table
--   branches / cohorts     free text survives one pilot college; normalise
--                          before a second one spells "C.S.E." differently
--
-- That is a deliberate deviation from the document, not an oversight. Each one
-- is cheap to add later and expensive to carry unused.
-- ============================================================================


-- ── who is asking ───────────────────────────────────────────────────────
-- Every college-scoped policy repeats the same subquery. One helper instead:
-- it is written once, and STABLE so the planner evaluates it per statement
-- rather than per row.
create or replace function public.my_college_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  select id from public.colleges where user_id = (select auth.uid()) limit 1;
$fn$;

revoke all on function public.my_college_id() from public, anon;
grant execute on function public.my_college_id() to authenticated;


-- ── 1. the student record ───────────────────────────────────────────────
-- roll_number is how a college actually names a student. A placement officer
-- handed a list of absentees is handed roll numbers, not email addresses.
alter table public.student_profiles
  add column roll_number text,
  -- Onboarding, as columns rather than a table: exactly one row per student,
  -- no history worth keeping, so a second table would only add a join.
  add column onboarding_status text not null default 'invited'
    check (onboarding_status in ('invited','started','in_progress','completed','blocked')),
  add column calibration_completed boolean not null default false,
  add column first_task_completed  boolean not null default false,
  add column invited_at    timestamptz,
  add column onboarded_at  timestamptz;

-- Unique per college, not globally: two colleges may legitimately both have a
-- student numbered 23CSE041. Partial, so students with no roll number yet do
-- not collide with each other on null.
create unique index student_profiles_roll_per_college
  on public.student_profiles (college_id, roll_number)
  where roll_number is not null and college_id is not null;

create index student_profiles_college_activity_idx
  on public.student_profiles (college_id, last_active desc nulls last);


-- ── 2. what a student actually did ──────────────────────────────────────
-- The engine behind recency, participation and every at-risk rule. Until now
-- there was only last_active — one timestamp, enough to say "quiet for eight
-- days" and not enough to say "87% active this week, down four points".
--
-- Append-only and deliberately narrow. This becomes the largest table in the
-- database: ten thousand students at five events a day is eighteen million
-- rows a year, so it carries no text blobs and only the indexes it needs.
create table public.student_activity_events (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  college_id  uuid references public.colleges(id) on delete set null,
  event_type  text not null check (event_type in (
                'login','lot_started','lot_submitted','voice_recorded',
                'topic_cleared','proof_submitted','proof_verified',
                'skill_assessed','profile_updated','match_participated')),
  source_type text,
  source_id   uuid,
  occurred_at timestamptz not null default now(),
  metadata    jsonb not null default '{}'::jsonb
);

-- college_id is denormalised onto the row on purpose. Every college-facing
-- count filters by it, and joining through student_profiles for eighteen
-- million rows to answer "how many were active this week" is the difference
-- between a dashboard and a timeout.
create index student_activity_college_idx on public.student_activity_events (college_id, occurred_at desc);
create index student_activity_student_idx on public.student_activity_events (student_id, occurred_at desc);
create index student_activity_type_idx    on public.student_activity_events (event_type, occurred_at desc);

-- Records an event and moves last_active in the same breath, so the two can
-- never disagree. Never throws: activity accounting must not be able to fail
-- the thing it is describing.
create or replace function public.log_activity(
  _student_id uuid, _event_type text,
  _source_type text default null, _source_id uuid default null,
  _metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  cid uuid;
begin
  if _student_id is null then return; end if;
  select college_id into cid from public.student_profiles where id = _student_id;

  insert into public.student_activity_events
    (student_id, college_id, event_type, source_type, source_id, metadata)
  values (_student_id, cid, _event_type, _source_type, _source_id, coalesce(_metadata,'{}'::jsonb));

  perform set_config('app.system_write','on',true);
  update public.student_profiles set last_active = now() where id = _student_id;
  perform set_config('app.system_write','off',true);
exception when others then
  return;
end $fn$;

revoke all on function public.log_activity(uuid,text,text,uuid,jsonb) from public, anon, authenticated;


-- ── 3. squad membership becomes a history ───────────────────────────────
-- It recorded who is in a squad now. The specification calls this the
-- historical source of truth, and a move you cannot reconstruct afterwards is
-- an assertion rather than a record.
alter table public.squad_members
  add column left_at     timestamptz,
  add column assigned_by uuid references auth.users(id) on delete set null,
  add column membership_type text not null default 'regular'
    check (membership_type in ('regular','captain','substitute'));

-- The old constraint allowed one row per student per squad, which blocks a
-- student ever rejoining a squad they left. What actually has to be true is
-- narrower and more useful: one ACTIVE squad at a time.
alter table public.squad_members drop constraint squad_members_student_id_squad_id_key;

create unique index squad_members_one_active_squad
  on public.squad_members (student_id) where left_at is null;

create index squad_members_history_idx on public.squad_members (student_id, joined_at desc);


-- ── 4. the skill gap the dashboard counts ───────────────────────────────
-- student_skills was already built with the right shape and has never been
-- read. Its statuses were claimed, assessed and proven — three of the four the
-- specification names. The fourth is the one every skill-gap number counts.
alter table public.student_skills drop constraint student_skills_status_check;
alter table public.student_skills add constraint student_skills_status_check
  check (status in ('claimed','assessed','proven','needs_improvement'));

create index student_skills_gap_idx on public.student_skills (skill, status);


-- ── 5. seasons get a shape ──────────────────────────────────────────────
-- Also already built, also never read. current_week is deliberately NOT stored
-- — it is a function of today and the start date, and a stored copy is a
-- second source of truth that goes stale every Monday at midnight.
alter table public.seasons
  add column college_id    uuid references public.colleges(id) on delete cascade,
  add column planned_weeks integer not null default 10 check (planned_weeks between 1 and 52),
  add column status        text not null default 'active'
    check (status in ('upcoming','active','complete')),
  add column champion_squad_id uuid references public.squads(id) on delete set null;

create index seasons_college_idx on public.seasons (college_id, is_current);

create or replace function public.season_week(_season_id uuid)
returns integer language sql stable set search_path = public, pg_temp as $fn$
  select greatest(1, least(s.planned_weeks,
           (floor((current_date - s.starts_on) / 7.0) + 1)::int))
    from public.seasons s where s.id = _season_id;
$fn$;


-- ── 6. what the officer did about it ────────────────────────────────────
-- "Rahul quiet for eight days, reminder sent." Without this nobody can ever
-- answer whether nudging students actually works.
create table public.interventions (
  id          uuid primary key default gen_random_uuid(),
  college_id  uuid not null references public.colleges(id) on delete cascade,
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  created_by  uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('reminder','call','meeting','warning','note')),
  reason      text not null check (length(trim(reason)) > 0),
  message     text,
  status      text not null default 'open' check (status in ('open','resolved','ignored')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index interventions_student_idx on public.interventions (student_id, created_at desc);
create index interventions_college_idx on public.interventions (college_id, status, created_at desc);


-- ── 7. imports leave a record ───────────────────────────────────────────
-- The importer already works. What it does not do is leave anything behind, so
-- "seventy rows, sixty-six valid, two duplicates, two missing emails" cannot be
-- shown, and a failed row cannot be handed back to be fixed.
create table public.student_imports (
  id             uuid primary key default gen_random_uuid(),
  college_id     uuid not null references public.colleges(id) on delete cascade,
  uploaded_by    uuid not null references auth.users(id) on delete cascade,
  file_name      text not null,
  total_rows     integer not null default 0,
  valid_rows     integer not null default 0,
  invalid_rows   integer not null default 0,
  duplicate_rows integer not null default 0,
  status         text not null default 'validating'
    check (status in ('validating','previewed','committing','completed','failed','cancelled')),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index student_imports_college_idx on public.student_imports (college_id, started_at desc);

create table public.student_import_rows (
  id                uuid primary key default gen_random_uuid(),
  import_id         uuid not null references public.student_imports(id) on delete cascade,
  row_number        integer not null,
  roll_number       text,
  raw_data          jsonb not null default '{}'::jsonb,
  validation_status text not null default 'valid'
    check (validation_status in ('valid','invalid','duplicate')),
  error_message     text,
  student_id        uuid references public.student_profiles(id) on delete set null,
  unique (import_id, row_number)
);

create index student_import_rows_status_idx on public.student_import_rows (import_id, validation_status);


-- ── 8. the audit log finally gets used ──────────────────────────────────
alter table public.audit_logs
  add column college_id uuid references public.colleges(id) on delete cascade;

create index audit_logs_college_idx on public.audit_logs (college_id, created_at desc);

create or replace function public.write_audit(
  _action text, _table text, _record uuid,
  _old jsonb default null, _new jsonb default null, _college uuid default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  insert into public.audit_logs (user_id, college_id, action, table_name, record_id, old_values, new_values)
  values ((select auth.uid()), coalesce(_college, public.my_college_id()), _action, _table, _record, _old, _new);
end $fn$;

revoke all on function public.write_audit(text,text,uuid,jsonb,jsonb,uuid) from public, anon, authenticated;


-- ── security ────────────────────────────────────────────────────────────
alter table public.student_activity_events enable row level security;
alter table public.interventions           enable row level security;
alter table public.student_imports         enable row level security;
alter table public.student_import_rows     enable row level security;

-- A student sees their own history. Their college sees its own students'.
-- Nobody writes directly — log_activity is the only way in, so an event is
-- always something that happened rather than something somebody typed.
create policy activity_read on public.student_activity_events for select to authenticated
  using (student_id = (select auth.uid())
         or college_id = (select public.my_college_id())
         or (select public.is_admin()));

create policy interventions_read on public.interventions for select to authenticated
  using (student_id = (select auth.uid())
         or college_id = (select public.my_college_id())
         or (select public.is_admin()));

-- A college records its own interventions, against its own students, as itself.
create policy interventions_write on public.interventions for insert to authenticated
  with check (college_id = (select public.my_college_id())
              and created_by = (select auth.uid())
              and student_id in (select id from public.student_profiles
                                  where college_id = (select public.my_college_id())));

create policy interventions_update on public.interventions for update to authenticated
  using (college_id = (select public.my_college_id()))
  with check (college_id = (select public.my_college_id()));

create policy imports_own on public.student_imports for all to authenticated
  using (college_id = (select public.my_college_id()) or (select public.is_admin()))
  with check (college_id = (select public.my_college_id()));

create policy import_rows_own on public.student_import_rows for all to authenticated
  using (import_id in (select id from public.student_imports
                        where college_id = (select public.my_college_id())))
  with check (import_id in (select id from public.student_imports
                             where college_id = (select public.my_college_id())));

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

revoke insert, update, delete, truncate on public.student_activity_events from anon, authenticated;
revoke delete, truncate on public.interventions from anon, authenticated;
revoke truncate on public.student_imports, public.student_import_rows from anon, authenticated;

-- Roll number and the onboarding fields are the college's to set, not the
-- student's — a student who could mark their own onboarding complete would.
-- Rebuilt rather than added to, because a trigger's guarded column list is
-- fixed at creation. Every column the old trigger protected is repeated here —
-- dropping one silently would hand it back to the student.
drop trigger if exists protect_student_profiles on public.student_profiles;
create trigger protect_student_profiles
  before update on public.student_profiles
  for each row execute function public.protect_columns(
    -- previously guarded, kept
    'total_xp','trust_score','college_id','status','source','profile_completed',
    -- new in this stage
    'onboarding_status','calibration_completed','first_task_completed',
    'invited_at','onboarded_at','roll_number');
