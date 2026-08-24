-- recruiter_shortlists already carries updated_at (maintained by the existing
-- recruiter_shortlists_set_updated_at trigger) — record_outcome's stage change
-- just wasn't being read anywhere. Pointing the placement report and a
-- student's own status at it instead of the unrelated responded_at column.

create or replace function public.tpo_placement_report()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  cid uuid := coalesce(public.my_college_id(), public.viewer_college_id());
  pipeline jsonb; hires jsonb; by_company jsonb;
begin
  if cid is null then
    return jsonb_build_object('error', 'Only a college can read this report.');
  end if;

  select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) into pipeline
    from (select sl.stage, count(*) as n
            from public.recruiter_shortlists sl
            join public.student_profiles p on p.id = sl.student_id
           where p.college_id = cid
           group by sl.stage) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'student', p.full_name, 'company', r.company,
           'hired_on', sl.updated_at) order by sl.updated_at desc),
         '[]'::jsonb)
    into hires
    from public.recruiter_shortlists sl
    join public.student_profiles p on p.id = sl.student_id
    join public.recruiters r on r.id = sl.recruiter_id
   where p.college_id = cid and sl.stage = 'hired';

  select coalesce(jsonb_agg(jsonb_build_object('company', c.company, 'hires', c.n)
                   order by c.n desc), '[]'::jsonb)
    into by_company
    from (select r.company, count(*) as n
            from public.recruiter_shortlists sl
            join public.student_profiles p on p.id = sl.student_id
            join public.recruiters r on r.id = sl.recruiter_id
           where p.college_id = cid and sl.stage = 'hired'
           group by r.company) c;

  return jsonb_build_object(
    'pipeline', pipeline,
    'hired_total', (select count(*) from public.recruiter_shortlists sl
                     join public.student_profiles p on p.id = sl.student_id
                    where p.college_id = cid and sl.stage = 'hired'),
    'hires', hires,
    'by_company', by_company
  );
end $$;

create or replace function public.my_placement_status()
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when sl.id is null then jsonb_build_object('placed', false)
         else jsonb_build_object('placed', true, 'company', r.company,
                                  'since', sl.updated_at)
         end
    from (select 1) one
    left join lateral (
      select sl.id, sl.updated_at, sl.recruiter_id
        from public.recruiter_shortlists sl
       where sl.student_id = auth.uid() and sl.stage = 'hired'
       order by sl.updated_at desc limit 1
    ) sl on true
    left join public.recruiters r on r.id = sl.recruiter_id;
$$;
