-- ============================================================================
-- Found by tracing every table and function the four student destinations
-- actually reach — 81 files from StudentDashboard.tsx down — and checking each
-- one against what exists in the database.
--
-- Five things the dashboard calls were missing. Each would have thrown the
-- moment a student opened the screen that uses it:
--
--   student_portfolios    Profile → Settings and Profile → Portfolio
--   task_applications     useAllStudentTasks, which the Daily Card depends on
--   get_leaderboard       useStudentProfile — used by every single screen
--   follow_user/unfollow  the follow button
--   set_proof_publicity   publishing your own work
--
-- Two other names the trace flagged, `proofs` and `resumes`, turned out to be
-- storage buckets rather than tables. Both exist. Not bugs.
-- ============================================================================

create table public.student_portfolios (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null unique references public.student_profiles(id) on delete cascade,
  bio          text,
  skills       text[] not null default '{}',
  projects     jsonb,
  achievements text,
  slug         text unique,
  is_public    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger student_portfolios_set_updated_at before update on public.student_portfolios
  for each row execute function public.set_updated_at();

alter table public.student_portfolios enable row level security;

-- A portfolio exists to be shown. Anyone signed in may read one its owner has
-- made public; only the owner writes theirs.
create policy student_portfolios_read on public.student_portfolios for select to authenticated
  using (is_public or student_id = (select auth.uid()) or public.is_admin());
create policy student_portfolios_own_insert on public.student_portfolios for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy student_portfolios_own_update on public.student_portfolios for update to authenticated
  using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));

create table public.task_applications (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.tasks(id) on delete cascade,
  student_id       uuid not null references public.student_profiles(id) on delete cascade,
  status           text not null default 'pending',
  application_note text,
  portfolio_link   text,
  rejection_reason text,
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (task_id, student_id)
);

create index task_applications_student_idx on public.task_applications (student_id);
create index task_applications_task_idx on public.task_applications (task_id);
create index task_applications_reviewed_by_idx on public.task_applications (reviewed_by);

create trigger task_applications_set_updated_at before update on public.task_applications
  for each row execute function public.set_updated_at();

alter table public.task_applications enable row level security;

create policy task_applications_read on public.task_applications for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());
create policy task_applications_own_insert on public.task_applications for insert to authenticated
  with check (student_id = (select auth.uid()));

-- The verdict on an application is not the applicant's to write.
create trigger protect_task_applications before update on public.task_applications
  for each row execute function public.protect_columns(
    'status', 'rejection_reason', 'reviewed_by', 'reviewed_at');

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke truncate, references, trigger on public.student_portfolios from anon, authenticated;
revoke truncate, references, trigger on public.task_applications from anon, authenticated;


-- ── the four missing functions ──────────────────────────────────────────

-- Both ids are auth user ids. The previous schema mixed a profile id into
-- following_id while every function assumed an auth id, so follow counts read
-- zero for everyone and follow notifications reached nobody.
create or replace function public.follow_user(target_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if auth.uid() = target_id then raise exception 'you cannot follow yourself'; end if;
  insert into public.user_follows (follower_id, following_id)
  values (auth.uid(), target_id)
  on conflict (follower_id, following_id) do nothing;   -- a double tap is not an error
end $fn$;

create or replace function public.unfollow_user(target_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.user_follows where follower_id = auth.uid() and following_id = target_id;
end $fn$;

-- Ranks by XP, and returns public fields only — never contact details. That is
-- why the leaderboard is a function rather than a view over student_profiles.
create or replace function public.get_leaderboard(_limit integer default 100)
returns table (id uuid, full_name text, profile_photo_url text, total_xp integer,
               trust_score numeric, rank bigint)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p.id, p.full_name, p.profile_photo_url, p.total_xp, p.trust_score,
         rank() over (order by p.total_xp desc, p.created_at)
  from public.student_profiles p
  where p.status = 'active'
  order by p.total_xp desc, p.created_at
  limit greatest(_limit, 1);
$fn$;

-- Ownership is checked here rather than trusted from the caller, so passing
-- somebody else's proof id does nothing.
create or replace function public.set_proof_publicity(p_proof_id uuid, p_is_public boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare owner uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select student_id into owner from public.proof_uploads where id = p_proof_id;
  if owner is null then raise exception 'proof not found'; end if;
  if owner <> auth.uid() then raise exception 'not yours to share'; end if;
  update public.proof_uploads set is_public = p_is_public where id = p_proof_id;
end $fn$;

-- New functions arrive with EXECUTE granted to PUBLIC, so sweep and re-grant
-- the allow-list. Re-run this after adding any function.
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
