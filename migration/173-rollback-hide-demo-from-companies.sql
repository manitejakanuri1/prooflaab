-- Rollback of 173: demo accounts visible to companies again; recommendations without the proof filter.
begin;
CREATE OR REPLACE FUNCTION public.student_is_discoverable(_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
      from public.student_profiles p
      join public.student_portfolios f on f.student_id = p.id
     where p.id = _student_id
       and p.status = 'active'
       and f.is_public = true);
$function$;

CREATE OR REPLACE FUNCTION public.recruiter_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'recommended', (select coalesce(jsonb_agg(r order by r.skills_proven desc), '[]'::jsonb) from (
        select t.student_id, t.full_name, t.branch, t.target_role,
               t.skills_proven, t.proofs_verified, t.comms_score, t.days_since_active
          from public.recruiter_talent(null, null, null, null, null, 30, 5, 0) t
         where not t.shortlisted) r),
    'recent_views', (select coalesce(jsonb_agg(v order by v.viewed_at desc), '[]'::jsonb) from (
        select rv.student_id, p.full_name, rv.viewed_at
          from public.recruiter_views rv
          join public.student_profiles p on p.id = rv.student_id
         where rv.recruiter_id = rid
         order by rv.viewed_at desc limit 8) v)
  );
end
$function$;
drop function if exists public.is_demo_student(uuid);
commit;
notify pgrst, 'reload schema';
