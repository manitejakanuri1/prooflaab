-- 33: what a student is learning, for the college (and admin) student profile.
begin;
create or replace function public.tpo_student_learning(_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cid uuid := public.my_college_id();
  me  uuid := (select auth.uid());
  p record;
begin
  select * into p from public.student_profiles where id = _student_id;
  if p is null then return jsonb_build_object('error', 'no such student'); end if;
  if not coalesce((cid is not null and p.college_id is not null and p.college_id = cid)
                  or coalesce(public.is_admin(), false) or (me is not null and p.id = me), false) then
    return jsonb_build_object('error', 'that student is not at your college');
  end if;

  return coalesce((
    with topic as (
      select l.track_slug, l.level_number,
             bool_or(coalesce(sl.status, '') in ('placed', 'revise'))
               or bool_and(coalesce(sl.status, '') in ('placed', 'cleared', 'mastered')) as done,
             count(*) filter (where l.kind = 'explanation' and coalesce(sl.status, '') in ('placed', 'cleared', 'mastered')) as steps_done,
             max(sl.updated_at) as last_at
        from public.levels l
        join public.student_tracks st on st.track_slug = l.track_slug and st.student_id = _student_id
        left join public.student_levels sl on sl.level_id = l.id and sl.student_id = _student_id
       group by l.track_slug, l.level_number
    ), per_track as (
      select t.track_slug, count(*)::int as topics_total, count(*) filter (where t.done)::int as topics_done,
             sum(t.steps_done)::int as steps_done, max(t.last_at) as last_at
        from topic t group by t.track_slug
    )
    select jsonb_agg(jsonb_build_object('slug', pt.track_slug, 'name', lt.name, 'emoji', lt.emoji,
             'topics_total', pt.topics_total, 'topics_done', pt.topics_done, 'steps_done', pt.steps_done,
             'last_active', pt.last_at) order by pt.last_at desc nulls last)
      from per_track pt join public.level_tracks lt on lt.slug = pt.track_slug
  ), '[]'::jsonb);
end $$;
revoke all on function public.tpo_student_learning(uuid) from public, anon;
grant execute on function public.tpo_student_learning(uuid) to authenticated, service_role;
commit;
notify pgrst, 'reload schema';
