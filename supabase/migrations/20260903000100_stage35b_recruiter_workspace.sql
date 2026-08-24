-- ============================================================================
-- Stage 35b — the recruiter's world: tables, the consent rule, and every
-- permission, written before a single screen exists.
--
-- Order is deliberate. A recruiter table that is readable for even an afternoon
-- is a student's evidence handed to a stranger, and permissions are cheap now
-- and expensive once real data is in them.
--
-- The consent rule is the important part. A student is discoverable only if
-- they made an active choice: profile_visibility 'public' AND their portfolio
-- switched on in Profile → Privacy. The portfolio switch is what signals
-- intent, because visibility defaults to public on the column and a default is
-- not a decision.
-- ============================================================================

-- ── who they are ────────────────────────────────────────────────────────
-- Anyone may sign up. An unverified recruiter sees the dashboard and no
-- candidates at all: verification is a human decision an admin makes, not a
-- box a recruiter ticks about themselves.
create table public.recruiters (
  id            uuid primary key references auth.users(id) on delete cascade,
  company       text not null,
  contact_name  text not null,
  work_email    text,
  website       text,
  about         text,
  verified      boolean not null default false,
  verified_at   timestamptz,
  verified_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger recruiters_set_updated_at before update on public.recruiters
  for each row execute function public.set_updated_at();

alter table public.recruiters enable row level security;

create policy recruiters_own_read on public.recruiters for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy recruiters_own_insert on public.recruiters for insert to authenticated
  with check (id = (select auth.uid()));
create policy recruiters_own_update on public.recruiters for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy recruiters_admin_update on public.recruiters for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));


-- ── am I a recruiter, and may I see anybody ─────────────────────────────
create or replace function public.my_recruiter_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  select id from public.recruiters where id = (select auth.uid()) limit 1;
$fn$;

create or replace function public.is_verified_recruiter()
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from public.recruiters
                  where id = (select auth.uid()) and verified);
$fn$;


-- ── the consent rule: one place decides, everything else asks ───────────
create or replace function public.student_is_discoverable(_student_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1
      from public.student_profiles p
      join public.student_portfolios f on f.student_id = p.id
     where p.id = _student_id
       and p.status = 'active'
       and p.profile_visibility = 'public'
       and f.is_public = true);
$fn$;


-- ── the shortlist ───────────────────────────────────────────────────────
-- Discovery is not consent to be contacted. A student is told they have been
-- shortlisted and decides whether that recruiter gets their contact details.
create table public.recruiter_shortlists (
  id            uuid primary key default gen_random_uuid(),
  recruiter_id  uuid not null references public.recruiters(id) on delete cascade,
  student_id    uuid not null references public.student_profiles(id) on delete cascade,
  note          text,
  stage         text not null default 'saved'
                  check (stage in ('saved', 'contacted', 'sponsored',
                                   'interviewing', 'offered', 'hired', 'passed')),
  student_response text check (student_response in ('accepted', 'declined')),
  responded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (recruiter_id, student_id)
);

create index recruiter_shortlists_recruiter_idx
  on public.recruiter_shortlists (recruiter_id, created_at desc);
create index recruiter_shortlists_student_idx
  on public.recruiter_shortlists (student_id);

create trigger recruiter_shortlists_set_updated_at
  before update on public.recruiter_shortlists
  for each row execute function public.set_updated_at();

alter table public.recruiter_shortlists enable row level security;

create policy shortlists_own_read on public.recruiter_shortlists for select to authenticated
  using (recruiter_id = (select auth.uid())
         or student_id = (select auth.uid())
         or (select public.is_admin()));
create policy shortlists_recruiter_write on public.recruiter_shortlists for insert to authenticated
  with check (recruiter_id = (select auth.uid())
              and (select public.is_verified_recruiter())
              and public.student_is_discoverable(student_id));
create policy shortlists_recruiter_update on public.recruiter_shortlists for update to authenticated
  using (recruiter_id = (select auth.uid()))
  with check (recruiter_id = (select auth.uid()));
create policy shortlists_recruiter_delete on public.recruiter_shortlists for delete to authenticated
  using (recruiter_id = (select auth.uid()));


-- ── what a recruiter looked at ──────────────────────────────────────────
-- Their own analytics, and an audit trail: a student is entitled to know who
-- has been reading their evidence.
create table public.recruiter_views (
  id            uuid primary key default gen_random_uuid(),
  recruiter_id  uuid not null references public.recruiters(id) on delete cascade,
  student_id    uuid not null references public.student_profiles(id) on delete cascade,
  viewed_at     timestamptz not null default now()
);

create index recruiter_views_recruiter_idx on public.recruiter_views (recruiter_id, viewed_at desc);
create index recruiter_views_student_idx   on public.recruiter_views (student_id, viewed_at desc);

alter table public.recruiter_views enable row level security;

create policy views_read on public.recruiter_views for select to authenticated
  using (recruiter_id = (select auth.uid())
         or student_id = (select auth.uid())
         or (select public.is_admin()));
create policy views_recruiter_insert on public.recruiter_views for insert to authenticated
  with check (recruiter_id = (select auth.uid())
              and (select public.is_verified_recruiter()));

revoke all on function public.my_recruiter_id()             from public, anon;
revoke all on function public.is_verified_recruiter()       from public, anon;
revoke all on function public.student_is_discoverable(uuid) from public, anon;
grant execute on function public.my_recruiter_id()             to authenticated;
grant execute on function public.is_verified_recruiter()       to authenticated;
grant execute on function public.student_is_discoverable(uuid) to authenticated;
