-- 54: companies see the real work (L1, N24).
--
-- Company > Work > Submissions read proof_uploads and Sponsored Lots read
-- proof_uploads through recruiter_lots(); students submit to task_submissions,
-- so a company never saw a single answer. Both now read task_submissions (+ the
-- student's voice explanation for that task) - the same source as the student's
-- Build-log and the college view.
--
--   company_submissions()            every latest submission on MY posted or sponsored tasks
--   recruiter_lots()                 my sponsored Lots with their real result
--   company_review_submission(...)   my decision on one submission (accepted / needs_work / rejected)
--
-- "Me" is auth.uid(): a company's startups.user_id and recruiters.id are the same
-- account (migration 15), and tasks carry created_by_startup_id / sponsored_by
-- with that id. Only approved companies get anything.
--
-- Rollback: migration/54-rollback-company-submissions.sql
begin;

create table if not exists public.submission_reviews (
  submission_id uuid primary key references public.task_submissions(id) on delete cascade,
  reviewer_id   uuid not null references auth.users(id) on delete cascade,
  decision      text not null check (decision in ('accepted', 'needs_work', 'rejected')),
  note          text check (note is null or length(note) <= 2000),
  reviewed_at   timestamptz not null default now()
);
alter table public.submission_reviews enable row level security;
revoke all on public.submission_reviews from public, anon, authenticated;
grant all on public.submission_reviews to service_role;

create or replace function public.my_company_ok()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (select auth.uid()) is not null and (
    public.is_verified_recruiter()
    or exists (select 1 from public.startups s
                where s.user_id = (select auth.uid()) and s.verification_status = 'approved'));
$$;

create or replace function public.company_submissions()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if not public.my_company_ok() then
    raise exception 'Your company account is awaiting approval.';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.submitted_at desc)
      from (
        select s.id as submission_id, t.id as task_id, t.title as task_title,
               case when t.sponsored_by = me then 'sponsored' else 'posted' end as source,
               p.id as student_id, p.full_name as student_name, c.name as college_name,
               s.status, s.sandbox_score as score, s.passed_count, s.total_count,
               case when s.sandbox_config_id is not null then 'code' else 'written' end as kind,
               s.language, s.code as work, s.created_at as submitted_at,
               (select count(*) from public.task_submissions a
                 where a.task_id = s.task_id and a.student_id = s.student_id) as attempts,
               v.status as voice_status, v.communication_score as voice_score,
               v.communication_notes as voice_notes, v.transcript as voice_transcript,
               r.decision as review_decision, r.note as review_note, r.reviewed_at
          from public.task_submissions s
          join public.tasks t on t.id = s.task_id
          join public.student_profiles p on p.id = s.student_id
          left join public.colleges c on c.id = p.college_id
          left join lateral (
            select ve.status, ve.communication_score, ve.communication_notes, ve.transcript
              from public.voice_explanations ve
             where ve.task_id = s.task_id and ve.student_id = s.student_id
             order by (ve.status = 'scored') desc, ve.created_at desc
             limit 1) v on true
          left join public.submission_reviews r on r.submission_id = s.id
         where (t.created_by_startup_id = me or t.sponsored_by = me)
           and s.created_at = (select max(l.created_at) from public.task_submissions l
                                where l.task_id = s.task_id and l.student_id = s.student_id)
      ) x), '[]'::jsonb);
end $$;

create or replace function public.company_review_submission(_submission_id uuid, _decision text, _note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if not public.my_company_ok() then
    raise exception 'Your company account is awaiting approval.';
  end if;
  if _decision not in ('accepted', 'needs_work', 'rejected') then
    raise exception 'Unknown decision.';
  end if;
  if not exists (select 1 from public.task_submissions s join public.tasks t on t.id = s.task_id
                  where s.id = _submission_id and (t.created_by_startup_id = me or t.sponsored_by = me)) then
    raise exception 'No such submission on your work.';
  end if;
  insert into public.submission_reviews (submission_id, reviewer_id, decision, note)
  values (_submission_id, me, _decision, nullif(trim(coalesce(_note, '')), ''))
  on conflict (submission_id) do update
    set reviewer_id = excluded.reviewer_id, decision = excluded.decision,
        note = excluded.note, reviewed_at = now();
  return jsonb_build_object('ok', true, 'submission_id', _submission_id, 'decision', _decision);
end $$;

drop function if exists public.recruiter_lots();
create function public.recruiter_lots()
returns table (task_id uuid, title text, student_id uuid, student_name text,
               created_at timestamptz, due_date timestamptz, task_status text,
               submission_id uuid, submitted_at timestamptz, submission_status text,
               score integer, voice_status text, outcome text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select t.id, t.title, t.student_id, p.full_name,
         t.created_at, t.due_date, t.status,
         s.id, s.created_at, s.status, s.sandbox_score,
         v.status, sl.stage
    from public.tasks t
    join public.student_profiles p on p.id = t.student_id
    left join lateral (
      select x.id, x.created_at, x.status, x.sandbox_score from public.task_submissions x
       where x.task_id = t.id and x.student_id = t.student_id
       order by x.created_at desc limit 1) s on true
    left join lateral (
      select ve.status from public.voice_explanations ve
       where ve.task_id = t.id and ve.student_id = t.student_id
       order by ve.created_at desc limit 1) v on true
    left join public.recruiter_shortlists sl
      on sl.recruiter_id = t.sponsored_by and sl.student_id = t.student_id
   where t.sponsored_by = public.my_recruiter_id()
   order by t.created_at desc;
$fn$;

revoke all on function public.my_company_ok()                                  from public, anon;
revoke all on function public.company_submissions()                            from public, anon;
revoke all on function public.company_review_submission(uuid, text, text)      from public, anon;
revoke all on function public.recruiter_lots()                                 from public, anon;
grant execute on function public.my_company_ok()                               to authenticated, service_role;
grant execute on function public.company_submissions()                         to authenticated, service_role;
grant execute on function public.company_review_submission(uuid, text, text)   to authenticated, service_role;
grant execute on function public.recruiter_lots()                              to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_proc where proname in ('recruiter_lots', 'company_submissions')
              and prosrc ilike '%proof_uploads%') then
    raise exception 'a company view still reads proof_uploads';
  end if;
  if has_function_privilege('anon', 'public.company_submissions()', 'EXECUTE') then
    raise exception 'anonymous callers could list submissions';
  end if;
  if has_table_privilege('authenticated', 'public.submission_reviews', 'SELECT') then
    raise exception 'reviews are readable directly';
  end if;
  raise notice '54: company submissions and sponsored Lots read task_submissions';
end $$;

commit;
notify pgrst, 'reload schema';
