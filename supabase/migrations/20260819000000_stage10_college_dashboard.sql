-- ============================================================================
-- The college dashboard, made to work again.
--
-- A college exists on this platform to see its own students' work. After the
-- rebuild it could see nothing: three tables were missing, two functions were
-- missing, and — the real problem — every row policy said "yours, or an
-- admin's". A college is neither, so a college admin opening their dashboard
-- got an empty list of their own students.
-- ============================================================================

-- ── college_profiles ────────────────────────────────────────────────────
-- The institution's public details. Separate from `colleges`, which holds the
-- account and its verification state: one is about the login, the other about
-- the institution.
create table public.college_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users(id) on delete cascade,
  college_name      text not null,
  location          text,
  profile_photo_url text,
  branches_offered  text[] not null default '{}',
  student_strength  integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger college_profiles_set_updated_at before update on public.college_profiles
  for each row execute function public.set_updated_at();

alter table public.college_profiles enable row level security;

create policy college_profiles_own_all on public.college_profiles for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

-- ── recruiter links ─────────────────────────────────────────────────────
-- A college generates a filtered, expiring link so a recruiter can look at
-- verified student work without creating an account. It carries an expiry
-- rather than living forever, because a link to real students' work that never
-- dies is a leak with a delay on it.
create table public.recruiter_links (
  id         uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  filters    jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  status     text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  created_at timestamptz not null default now()
);

create table public.recruiter_link_views (
  id         uuid primary key default gen_random_uuid(),
  link_id    uuid not null references public.recruiter_links(id) on delete cascade,
  ip_address inet,
  viewed_at  timestamptz not null default now()
);

create index recruiter_links_college_idx on public.recruiter_links (college_id);
create index recruiter_links_created_by_idx on public.recruiter_links (created_by);
create index recruiter_link_views_link_idx on public.recruiter_link_views (link_id, viewed_at desc);

alter table public.recruiter_links enable row level security;
alter table public.recruiter_link_views enable row level security;

create policy recruiter_links_own on public.recruiter_links for all to authenticated
  using (public.is_admin() or college_id in (
    select id from public.colleges where user_id = (select auth.uid())))
  with check (public.is_admin() or college_id in (
    select id from public.colleges where user_id = (select auth.uid())));

create policy recruiter_link_views_read on public.recruiter_link_views for select to authenticated
  using (public.is_admin() or link_id in (
    select rl.id from public.recruiter_links rl
    join public.colleges c on c.id = rl.college_id
    where c.user_id = (select auth.uid())));

-- ── a college can see its own students ──────────────────────────────────
-- Read-only, and scoped by student_profiles.college_id, which is set when a
-- college bulk-invites its students. A college sees their work, their scores
-- and their progress — and nothing at all about anybody else's students.
create policy student_profiles_college_read on public.student_profiles for select to authenticated
  using (college_id in (select id from public.colleges where user_id = (select auth.uid())));

create policy student_contact_college_read on public.student_contact for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
    join public.colleges c on c.id = sp.college_id
    where c.user_id = (select auth.uid())));

create policy proof_uploads_college_read on public.proof_uploads for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
    join public.colleges c on c.id = sp.college_id
    where c.user_id = (select auth.uid())));

create policy tasks_college_read on public.tasks for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
    join public.colleges c on c.id = sp.college_id
    where c.user_id = (select auth.uid())));

create policy trust_scores_college_read on public.trust_scores for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
    join public.colleges c on c.id = sp.college_id
    where c.user_id = (select auth.uid())));

create policy xp_logs_college_read on public.xp_logs for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
    join public.colleges c on c.id = sp.college_id
    where c.user_id = (select auth.uid())));

create policy task_applications_college_read on public.task_applications for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
    join public.colleges c on c.id = sp.college_id
    where c.user_id = (select auth.uid())));

create policy resume_scorecards_college_read on public.resume_scorecards for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
    join public.colleges c on c.id = sp.college_id
    where c.user_id = (select auth.uid())));

-- ── the two notification functions ──────────────────────────────────────
-- Three screens used to insert notifications straight from the browser, which
-- silently did nothing because there is no insert policy on notifications.
-- These do the write with the permission checked inside, so a student cannot
-- send messages that look like they came from staff.
create or replace function public.admin_notify_student(
  _student_id uuid, _title text, _message text, _type text default 'admin', _link text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare allowed boolean;
begin
  select public.is_admin() or exists (
    select 1 from public.student_profiles sp
    join public.colleges c on c.id = sp.college_id
    where sp.id = _student_id and c.user_id = auth.uid()
  ) into allowed;
  if not allowed then raise exception 'not allowed to notify this student'; end if;

  insert into public.notifications (user_id, actor_id, type, title, message, link, source, audience)
  values (_student_id, auth.uid(), _type, _title, _message, _link, 'staff', 'student');
end $fn$;

create or replace function public.notify_all_admins(
  _title text, _message text, _type text default 'system', _link text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  insert into public.notifications (user_id, actor_id, type, title, message, link, source, audience)
  select ur.user_id, auth.uid(), _type, _title, _message, _link, 'system', 'admin'
  from public.user_roles ur where ur.role = 'admin';
end $fn$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke truncate, references, trigger on public.college_profiles from anon, authenticated;
revoke truncate, references, trigger on public.recruiter_links from anon, authenticated;
revoke truncate, references, trigger on public.recruiter_link_views from anon, authenticated;

do $$
declare fn record;
begin
  for fn in select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.like_post(uuid) to authenticated;
grant execute on function public.unlike_post(uuid) to authenticated;
grant execute on function public.my_suggested_tracks(integer) to authenticated;
grant execute on function public.my_todays_lot() to authenticated;
grant execute on function public.follow_user(uuid) to authenticated;
grant execute on function public.unfollow_user(uuid) to authenticated;
grant execute on function public.get_leaderboard(integer) to authenticated;
grant execute on function public.set_proof_publicity(uuid, boolean) to authenticated;
grant execute on function public.admin_notify_student(uuid, text, text, text, text) to authenticated;
grant execute on function public.notify_all_admins(text, text, text, text) to authenticated;
