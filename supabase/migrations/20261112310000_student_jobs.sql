-- 310 (owner approved 12 Nov 2026, TEST): students get a Jobs page.
--  1) student_jobs(): the signed-in STUDENT sees jobs posted by their OWN college plus company jobs an admin
--     approved; never another college's jobs; nothing past its last date (India date). apply_link comes back
--     only when it is a plain https:// link, else null (the page then says "Ask your college how to apply").
--     Who posted a job is decided by the poster's account, never by the client-written `source` column:
--       college job = created_by is the user of the student's college;
--       company job = created_by has the startup role and is not a college account (a startup's status can only
--       become 'approved' by an admin - trigger job_opportunities_keep_moderation, migration 103).
--  2) The raw table: the old read policy let ANY signed-in user read every approved row (every college's jobs).
--     Now only the poster and admins read rows directly; students read only through student_jobs().
--     The Lot engine reads with the service role, so it is not affected.
--  3) job_apply_clicks: one row per Apply click. No table grants; written only by student_job_apply_click(),
--     which takes the student from the session and only accepts a job that student can see.
--  4) college_job_posts(): the signed-in college's own posts with "N students opened Apply".
-- Rollback: migration/310-rollback-student-jobs.sql
begin;

drop policy if exists job_opportunities_read on public.job_opportunities;
create policy job_opportunities_read on public.job_opportunities for select to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

create table if not exists public.job_apply_clicks (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.job_opportunities(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete cascade,
  clicked_at timestamptz not null default now()
);
create index if not exists job_apply_clicks_job_idx on public.job_apply_clicks (job_id, student_user_id);
alter table public.job_apply_clicks enable row level security;
revoke all on table public.job_apply_clicks from public, anon, authenticated;

create or replace function public.student_jobs()
returns table (job_id uuid, title text, company text, location text, job_type text, details text,
               last_date date, apply_link text, posted_by text)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
set timezone to 'Asia/Kolkata'
as $$
declare
  _college uuid;
begin
  select sp.college_id into _college from public.student_profiles sp where sp.user_id = (select auth.uid()) limit 1;
  if not found then
    raise exception 'Only students can see jobs' using errcode = '42501';
  end if;
  return query
  select j.id, j.role, j.company_name, j.location, j.job_type, j.description, j.deadline,
         case when j.apply_link ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
              then j.apply_link end,
         case when c.id is not null then 'college' else 'company' end
    from public.job_opportunities j
    left join public.colleges c on c.id = _college and c.user_id = j.created_by
   where j.status = 'approved'
     and (j.deadline is null or j.deadline >= current_date)
     and (c.id is not null
          or (exists (select 1 from public.user_roles r where r.user_id = j.created_by and r.role = 'startup')
              and not exists (select 1 from public.colleges oc where oc.user_id = j.created_by)))
   order by j.deadline nulls last, j.created_at desc
   limit 200;
end
$$;
revoke all on function public.student_jobs() from public, anon;
grant execute on function public.student_jobs() to authenticated;

create or replace function public.student_job_apply_click(_job_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path to 'public', 'pg_temp'
set timezone to 'Asia/Kolkata'
as $$
begin
  -- student_jobs() refuses non-students and returns only jobs this student may see.
  if not exists (select 1 from public.student_jobs() s where s.job_id = _job_id and s.apply_link is not null) then
    return false;
  end if;
  insert into public.job_apply_clicks (job_id, student_user_id) values (_job_id, (select auth.uid()));
  return true;
end
$$;
revoke all on function public.student_job_apply_click(uuid) from public, anon;
grant execute on function public.student_job_apply_click(uuid) to authenticated;

create or replace function public.college_job_posts()
returns table (job_id uuid, title text, company text, last_date date, status text, students_opened_apply bigint)
language sql stable security definer
set search_path to 'public', 'pg_temp'
set timezone to 'Asia/Kolkata'
as $$
  select j.id, j.role, j.company_name, j.deadline, j.status,
         (select count(distinct k.student_user_id) from public.job_apply_clicks k where k.job_id = j.id)
    from public.job_opportunities j
   where public.my_college_id() is not null
     and j.created_by = (select auth.uid())
   order by j.created_at desc
   limit 100;
$$;
revoke all on function public.college_job_posts() from public, anon;
grant execute on function public.college_job_posts() to authenticated;

do $$
begin
  if to_regclass('public.job_apply_clicks') is null
     or to_regprocedure('public.student_jobs()') is null
     or to_regprocedure('public.student_job_apply_click(uuid)') is null
     or to_regprocedure('public.college_job_posts()') is null then
    raise exception '310: object missing';
  end if;
  if exists (select 1 from pg_policies where tablename = 'job_opportunities' and policyname = 'job_opportunities_read'
              and qual ilike '%approved%') then
    raise exception '310: read policy still opens approved rows to everyone';
  end if;
  if has_table_privilege('authenticated', 'public.job_apply_clicks', 'insert,select') then
    raise exception '310: job_apply_clicks is open to authenticated';
  end if;
  -- Not signed in: no college rows, and student_jobs refuses.
  if exists (select 1 from public.college_job_posts()) then
    raise exception '310: college_job_posts returned rows without a college session';
  end if;
  begin
    perform public.student_jobs();
    raise exception '310: student_jobs answered without a student session';
  exception when insufficient_privilege then null;
  end;
end $$;

commit;
notify pgrst, 'reload schema';
