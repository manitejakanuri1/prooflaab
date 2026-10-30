-- 173 (MF-056, MF-084, owner decision 8, 30 Oct 2026): companies never see demo or test accounts, and Company
--   Home recommends only students with proof.
--   is_demo_student: the student's college is a demo/fake college, or the login is a smoke / *.invalid /
--   *.local test address, or the name starts with Fake / Demo / Test. student_is_discoverable (the one gate
--   for every company screen: Talent, Home, profile, voice play) now refuses those.
--   recruiter_home "recommended" now needs at least one passed Lot (proofs_verified > 0).
-- Rollback: migration/173-rollback-hide-demo-from-companies.sql
begin;

create or replace function public.is_demo_student(_student_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1
      from public.student_profiles p
      left join public.colleges c on c.id = p.college_id
      left join auth.users u on u.id = p.id
     where p.id = _student_id
       and (c.name ~* '(demo|fake)'
            or u.email ~* '(\+smoke|\.invalid$|\.local$)'
            or p.full_name ~* '^(fake|demo|test)\M'));
$fn$;
revoke all on function public.is_demo_student(uuid) from public, anon, authenticated;
grant execute on function public.is_demo_student(uuid) to service_role;

create or replace function public.student_is_discoverable(_student_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1
      from public.student_profiles p
      join public.student_portfolios f on f.student_id = p.id
     where p.id = _student_id
       and p.status = 'active'
       and f.is_public = true)
     and not public.is_demo_student(_student_id);   -- 173 (MF-056)
$fn$;

create or replace function public.recruiter_home()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare rid uuid := public.my_recruiter_id(); me record;
begin
  if rid is null then return jsonb_build_object('error', 'not a recruiter'); end if;
  select * into me from public.recruiters where id = rid;
  if not me.verified then
    return jsonb_build_object(
      'verified', false,
      'company', me.company,
      'message', 'Your account is awaiting verification. Candidates appear once ' ||
                 'an administrator has approved you.');
  end if;
  return jsonb_build_object(
    'verified', true,
    'company', me.company,
    'candidates_available', (select count(*) from public.student_profiles p
                              where public.student_is_discoverable(p.id)),
    'new_this_week', (select count(*) from public.student_profiles p
                       where public.student_is_discoverable(p.id)
                         and p.created_at >= now() - interval '7 days'),
    'shortlisted', (select count(*) from public.recruiter_shortlists
                     where recruiter_id = rid),
    'awaiting_response', (select count(*) from public.recruiter_shortlists
                           where recruiter_id = rid and student_response is null),
    'accepted', (select count(*) from public.recruiter_shortlists
                  where recruiter_id = rid and student_response = 'accepted'),
    'lots_open', (select count(*) from public.tasks t
                   where t.sponsored_by = rid and t.status = 'pending'),
    'lots_submitted', (select count(*) from public.tasks t
                        where t.sponsored_by = rid
                          and exists (select 1 from public.task_submissions ts where ts.task_id = t.id)),
    'pipeline', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
        select stage, count(*) as n from public.recruiter_shortlists
         where recruiter_id = rid group by stage) s),
    -- 173 (MF-084): only students with at least one passed Lot are recommended.
    'recommended', (select coalesce(jsonb_agg(r order by r.proofs_verified desc, r.skills_proven desc), '[]'::jsonb) from (
        select t.student_id, t.full_name, t.branch, t.target_role,
               t.skills_proven, t.proofs_verified, t.comms_score, t.days_since_active
          from public.recruiter_talent(null, null, null, null, null, 30, 20, 0) t
         where not t.shortlisted and t.proofs_verified > 0
         limit 5) r),
    'recent_views', (select coalesce(jsonb_agg(v order by v.viewed_at desc), '[]'::jsonb) from (
        select rv.student_id, p.full_name, rv.viewed_at
          from public.recruiter_views rv
          join public.student_profiles p on p.id = rv.student_id
         where rv.recruiter_id = rid
         order by rv.viewed_at desc limit 8) v)
  );
end
$fn$;

do $$
declare demo_open integer;
begin
  select count(*) into demo_open from public.student_profiles p
   where public.is_demo_student(p.id) and public.student_is_discoverable(p.id);
  if demo_open > 0 then raise exception '173: % demo students still visible to companies', demo_open; end if;
  if pg_get_functiondef('public.recruiter_home()'::regprocedure) !~ 'proofs_verified > 0' then
    raise exception '173: recommendations are not limited to students with proof';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
