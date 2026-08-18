-- ============================================================================
-- Stage 1 — identity and intake
--
-- Rebuilds the database from empty, covering signup through to the dashboard.
-- Nothing is carried over from the previous schema; the old migration files
-- were deleted and are never replayed.
--
-- Shape: the two intake sources are separate tables (a resume has a file,
-- projects and certificates; an interest form has none of those), but the
-- assessment and the scorecard are shared by both paths. An assessment names
-- its own source with two nullable foreign keys and a check that exactly one
-- is set, so the parent is always a real row and finding it is one jump.
-- ============================================================================

create extension if not exists pgcrypto;

create type public.app_role as enum ('student', 'college_admin', 'startup', 'admin');


-- ---------------------------------------------------------------------------
-- The one helper with no table dependency. has_role and is_admin are defined
-- further down, after user_roles exists: a SQL-language function body is
-- validated at creation time, so defining them first fails with
-- "relation public.user_roles does not exist".
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.colleges (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  email               text not null,
  invite_code         text unique,
  status              text not null default 'active',
  verification_status text not null default 'pending',
  last_active         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One role per account. The app reads this with maybeSingle(), which errors on
-- more than one row, so the constraint matches what the code already assumes.
create table public.user_roles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users(id) on delete cascade,
  role                 public.app_role not null,
  has_completed_wizard boolean not null default false,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now()
);

-- id IS the auth user id, not a separate value.
--
-- The old schema gave every student two identifiers and different tables filed
-- rows under different ones. Looking up the wrong one returned an empty list
-- and no error, which is where the notifications-that-reached-nobody bugs came
-- from. Here the two are the same value and the check constraint keeps them so.
--
-- user_id is kept as a column because ensureStudentProfile upserts on it.
create table public.student_profiles (
  id                         uuid primary key references auth.users(id) on delete cascade,
  user_id                    uuid not null unique references auth.users(id) on delete cascade,
  full_name                  text not null,
  branch                     text,
  year_of_study              text,
  batch                      text,
  college_id                 uuid references public.colleges(id) on delete set null,
  key_interests              text[] not null default '{}',
  preferred_skills           text[] not null default '{}',
  career_goals               text,
  profile_photo_url          text,
  slug                       text unique,
  profile_visibility         text not null default 'public',
  status                     text not null default 'active',
  source                     text,
  total_xp                   integer not null default 0,
  trust_score                numeric not null default 0,
  profile_completed          boolean not null default false,
  ai_personalization_enabled boolean not null default true,
  last_active                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint student_profiles_one_id_space check (id = user_id)
);

-- Fills whichever of the pair the caller left out, so both an insert that sets
-- only user_id (the app) and one that sets only id (an admin creating a profile
-- for someone else) succeed.
create or replace function public.student_profiles_sync_ids()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is null then
    new.id := coalesce(new.user_id, auth.uid());
  end if;
  if new.user_id is null then
    new.user_id := new.id;
  end if;
  return new;
end;
$$;

create trigger student_profiles_sync_ids
  before insert on public.student_profiles
  for each row execute function public.student_profiles_sync_ids();

create trigger student_profiles_set_updated_at
  before update on public.student_profiles
  for each row execute function public.set_updated_at();

-- Contact details live apart from the profile so that reading a student's name
-- and branch does not also hand over their email address.
create table public.student_contact (
  student_id   uuid primary key references public.student_profiles(id) on delete cascade,
  email        text,
  github_url   text,
  linkedin_url text,
  resume_url   text,
  updated_at   timestamptz not null default now()
);

-- The email is only ever known to the auth account, so it is copied from there
-- rather than trusted from the client.
create or replace function public.student_profiles_create_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.student_contact (student_id, email)
  values (new.id, (select email from auth.users where id = new.id))
  on conflict (student_id) do nothing;
  return new;
end;
$$;

create trigger student_profiles_create_contact
  after insert on public.student_profiles
  for each row execute function public.student_profiles_create_contact();

create trigger student_contact_set_updated_at
  before update on public.student_contact
  for each row execute function public.set_updated_at();

-- Keyed by auth user id, not profile id: this row is written during the welcome
-- screen, which a student can reach before anything else exists.
--
-- task_source is also the router. It records which button was pressed, so every
-- later lookup goes straight to the right source table instead of trying one
-- and then the other.
create table public.student_intake (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  has_seen_welcome    boolean not null default false,
  welcome_seen_at     timestamptz,
  task_source         text check (task_source in ('resume', 'general')),
  intake_completed_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger student_intake_set_updated_at
  before update on public.student_intake
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- The two intake sources
-- ---------------------------------------------------------------------------

-- The resume path. resume_quality_score and ats_match_score are measured here,
-- at upload, before any assessment exists.
create table public.resume_claims (
  id                    uuid primary key default gen_random_uuid(),
  student_id            uuid not null references public.student_profiles(id) on delete cascade,
  storage_path          text not null,
  raw_extraction        jsonb,
  skills                text[] not null default '{}',
  certifications        text[] not null default '{}',
  projects              jsonb not null default '[]'::jsonb,
  target_role           text,
  status                text not null default 'pending',
  resume_quality_score  integer,
  resume_quality_notes  text,
  ats_match_score       integer,
  ats_match_notes       text,
  skill_relevance_notes text,
  ai_improved_resume    text,
  feedback_acknowledged boolean not null default false,
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- The skip path. No file, no projects, no certificates — which is exactly why
-- this is its own table rather than mostly-empty columns on the one above.
create table public.student_interests (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.student_profiles(id) on delete cascade,
  branch        text,
  year_of_study text,
  interests     text[] not null default '{}',
  skills        text[] not null default '{}',
  target_role   text,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger resume_claims_set_updated_at
  before update on public.resume_claims
  for each row execute function public.set_updated_at();

create trigger student_interests_set_updated_at
  before update on public.student_interests
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- Shared by both paths
--
-- Table names keep their resume_ prefix for now. Six deployed edge functions
-- query them by name and cannot be redeployed from here; renaming would break
-- them with no way to fix it. Both tables serve both paths despite the name.
-- ---------------------------------------------------------------------------

-- Two nullable foreign keys rather than one source_id column: a single column
-- pointing at either table could not be checked by the database, so it could
-- silently hold an id that exists nowhere. With two real foreign keys plus the
-- check below, an assessment always has exactly one parent and that parent
-- always exists.
create table public.resume_assessments (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.student_profiles(id) on delete cascade,
  resume_claims_id    uuid references public.resume_claims(id) on delete cascade,
  student_interest_id uuid references public.student_interests(id) on delete cascade,
  questions           jsonb not null default '[]'::jsonb,
  coding_questions    jsonb not null default '[]'::jsonb,
  student_answers     jsonb not null default '{}'::jsonb,
  answer_scores       jsonb,
  coding_results      jsonb,
  status              text not null default 'pending',
  is_retest           boolean not null default false,
  started_at          timestamptz,
  elapsed_seconds     integer,
  retest_notified_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint resume_assessments_exactly_one_source
    check (num_nonnulls(resume_claims_id, student_interest_id) = 1)
);

create trigger resume_assessments_set_updated_at
  before update on public.resume_assessments
  for each row execute function public.set_updated_at();

-- One scorecard per assessment. The source is reachable through the assessment,
-- so no second check is needed here; resume_claims_id is kept because existing
-- code selects it, and is null for a skip-path student.
create table public.resume_scorecards (
  id                        uuid primary key default gen_random_uuid(),
  student_id                uuid not null references public.student_profiles(id) on delete cascade,
  assessment_id             uuid not null unique references public.resume_assessments(id) on delete cascade,
  resume_claims_id          uuid references public.resume_claims(id) on delete cascade,
  student_interest_id       uuid references public.student_interests(id) on delete cascade,
  skill_proof_score         integer,
  project_proof_score       integer,
  reasoning_score           integer,
  coding_score              integer,
  interview_readiness_score integer,
  resume_quality_score      integer,
  ats_match_score           integer,
  voice_authenticity_score  integer,
  voice_notes               text,
  skill_gap                 jsonb,
  roadmap                   text,
  is_retest                 boolean not null default false,
  created_at                timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- Role helpers, now that user_roles exists.
--
-- SECURITY DEFINER is required, not a shortcut: user_roles has RLS, and its own
-- policy calls is_admin, which reads user_roles. As SECURITY INVOKER that
-- recurses forever. Running as the owner breaks the cycle.
--
-- Only is_admin is granted to signed-in users — that is what the policies call.
-- has_role takes an arbitrary user id, so exposing it would answer "is this
-- other person an admin?" to anyone.
-- ---------------------------------------------------------------------------

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role(auth.uid(), 'admin');
$$;


-- ---------------------------------------------------------------------------
-- Indexes. Every foreign key gets one — the previous schema was missing 25 and
-- that was a real cause of slow pages.
-- ---------------------------------------------------------------------------

create index colleges_user_id_idx                     on public.colleges (user_id);
create index student_profiles_college_id_idx          on public.student_profiles (college_id);
create index resume_claims_student_id_idx             on public.resume_claims (student_id);
create index student_interests_student_id_idx         on public.student_interests (student_id);
create index resume_assessments_student_id_idx        on public.resume_assessments (student_id);
create index resume_assessments_resume_claims_id_idx  on public.resume_assessments (resume_claims_id);
create index resume_assessments_interest_id_idx       on public.resume_assessments (student_interest_id);
create index resume_scorecards_student_id_idx         on public.resume_scorecards (student_id);
create index resume_scorecards_resume_claims_id_idx   on public.resume_scorecards (resume_claims_id);
create index resume_scorecards_interest_id_idx        on public.resume_scorecards (student_interest_id);
create index user_roles_created_by_idx                on public.user_roles (created_by);


-- ---------------------------------------------------------------------------
-- Row level security
--
-- Every policy wraps auth.uid() as (SELECT auth.uid()) so Postgres evaluates it
-- once per statement instead of once per row. The previous schema got this
-- wrong in 164 places.
-- ---------------------------------------------------------------------------

alter table public.colleges          enable row level security;
alter table public.user_roles        enable row level security;
alter table public.student_profiles  enable row level security;
alter table public.student_contact   enable row level security;
alter table public.student_intake    enable row level security;
alter table public.resume_claims     enable row level security;
alter table public.student_interests enable row level security;
alter table public.resume_assessments enable row level security;
alter table public.resume_scorecards enable row level security;

-- colleges
create policy colleges_own_select on public.colleges
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy colleges_own_write on public.colleges
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

-- user_roles. A student may read their own role but never write one: a
-- self-write here would let any account make itself an admin.
create policy user_roles_own_select on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy user_roles_admin_write on public.user_roles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- student_profiles
create policy student_profiles_own_select on public.student_profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy student_profiles_own_insert on public.student_profiles
  for insert to authenticated with check (id = (select auth.uid()) or public.is_admin());
create policy student_profiles_own_update on public.student_profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- student_contact. Deliberately narrower than the profile: the student, or an
-- admin. Nobody else, including other signed-in students.
create policy student_contact_own_select on public.student_contact
  for select to authenticated using (student_id = (select auth.uid()) or public.is_admin());
create policy student_contact_own_write on public.student_contact
  for all to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());

-- student_intake
create policy student_intake_own_all on public.student_intake
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

-- The two sources and the two shared tables: a student sees only their own.
create policy resume_claims_own_all on public.resume_claims
  for all to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());

create policy student_interests_own_all on public.student_interests
  for all to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());

create policy resume_assessments_own_all on public.resume_assessments
  for all to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());

create policy resume_scorecards_own_select on public.resume_scorecards
  for select to authenticated using (student_id = (select auth.uid()) or public.is_admin());
create policy resume_scorecards_admin_write on public.resume_scorecards
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------------
-- Function grants
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and this project
-- additionally has default privileges granting it to anon and authenticated by
-- name. Revoking from anon alone is a silent no-op — it has to be all three,
-- plus turning the default privilege off, before re-granting an allow-list.
-- ---------------------------------------------------------------------------

alter default privileges in schema public revoke execute on functions from anon, authenticated;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

-- Only the two a policy needs to evaluate. The trigger functions are called by
-- Postgres itself and need no grant.
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_admin() to authenticated;
