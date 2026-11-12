-- Rollback of 320: the 12 Nov 2026 TEST definitions before 320.
begin;

CREATE OR REPLACE FUNCTION public.my_achievements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  me      uuid := (select auth.uid());
  today   date := (now() at time zone 'Asia/Kolkata')::date;
  monday  date := today - (extract(isodow from today)::int - 1);
  topics  int; streak int; proofs int; phases int;
begin
  if me is null or not exists (select 1 from public.student_profiles where id = me) then
    return jsonb_build_object('earned', '[]'::jsonb, 'quests', '[]'::jsonb);
  end if;

  select count(*) into topics from public.student_levels where student_id = me and status in ('cleared', 'mastered');
  select coalesce(max(longest_days), 0) into streak from public.student_streaks where student_id = me;
  select count(distinct task_id) into proofs from public.task_submissions where student_id = me and status = 'passed';
  select count(*) into phases
    from public.track_phases ph
    join public.student_tracks st on st.track_slug = ph.track_slug and st.student_id = me
   where not exists (select 1 from public.levels l
                      where l.track_slug = ph.track_slug and l.sub_level = 1
                        and l.level_number between ph.from_level and ph.to_level
                        and not exists (select 1 from public.student_levels sl
                                         where sl.student_id = me and sl.level_id = l.id
                                           and sl.status in ('cleared', 'mastered')))
     and exists (select 1 from public.levels l where l.track_slug = ph.track_slug and l.sub_level = 1
                   and l.level_number between ph.from_level and ph.to_level);

  insert into public.student_badges (student_id, badge_slug)
  select me, b.slug from public.badges b
   where (b.rule_kind = 'level'  and topics >= b.rule_value)
      or (b.rule_kind = 'streak' and streak >= b.rule_value)
      or (b.rule_kind = 'proof'  and proofs >= b.rule_value)
      or (b.rule_kind = 'phase'  and phases >= b.rule_value)
  on conflict do nothing;

  return jsonb_build_object(
    'earned', coalesce((select jsonb_agg(jsonb_build_object('badge_slug', badge_slug, 'awarded_at', awarded_at))
                          from public.student_badges where student_id = me), '[]'::jsonb),
    'quests', coalesce((
      select jsonb_agg(jsonb_build_object('quest_slug', q.slug, 'progress', least(n.c, q.target), 'done', n.c >= q.target))
        from public.quests q
        cross join lateral (select case q.metric
            when 'lot_submitted' then (select count(distinct s.task_id) from public.task_submissions s join public.tasks t on t.id = s.task_id
                                        where s.student_id = me and t.lot_date is not null
                                          and (s.created_at at time zone 'Asia/Kolkata')::date >= case q.cadence when 'daily' then today else monday end)
            when 'voice_recorded' then (select count(*) from public.voice_explanations v
                                        where v.student_id = me
                                          and (v.created_at at time zone 'Asia/Kolkata')::date >= case q.cadence when 'daily' then today else monday end)
            when 'topic_cleared' then (select count(*) from public.student_levels sl
                                        where sl.student_id = me and sl.status in ('cleared', 'mastered')
                                          and (coalesce(sl.cleared_at, sl.mastered_at) at time zone 'Asia/Kolkata')::date >= case q.cadence when 'daily' then today else monday end)
            else (select count(distinct s.task_id) from public.task_submissions s
                   where s.student_id = me and s.status = 'passed'
                     and (s.created_at at time zone 'Asia/Kolkata')::date >= case q.cadence when 'daily' then today else monday end)
          end::int as c) n
       where q.is_active), '[]'::jsonb));
end $function$;

update public.quests set description = 'Submit the Lot waiting on your Daily Card.' where slug = 'daily-lot';
update public.quests set description = 'Submit five daily Lots this week.' where slug = 'weekly-five-lots';
update public.quests set description = 'Record one 60-second explanation of your own work.' where slug = 'daily-explain';

CREATE OR REPLACE FUNCTION public.portfolio_work(_student_id uuid)
 RETURNS TABLE(task_id uuid, title text, category text, kind text, language text, score integer, passed_count integer, total_count integer, passed_at timestamp with time zone, explanation_score integer, set_by text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select t.id, t.title, coalesce(t.lot_category, t.category),
         case when s.sandbox_config_id is not null then 'code' else 'written' end,
         s.language, s.sandbox_score, s.passed_count, s.total_count, s.created_at,
         (select v.communication_score from public.voice_explanations v
           where v.submission_id = s.id and v.status = 'scored' and v.withdrawn_at is null and v.communication_score >= 50
           order by v.current_authoritative desc, v.created_at desc limit 1),
         (select st.name from public.startups st where st.user_id = t.sponsored_by)
    from public.task_submissions s
    join public.tasks t on t.id = s.task_id
   where s.student_id = _student_id
     and s.status = 'passed'
     and s.created_at = (select max(l.created_at) from public.task_submissions l
                          where l.task_id = s.task_id and l.student_id = s.student_id and l.status = 'passed')
     and (
          _student_id = (select auth.uid())
       or coalesce((select public.is_admin()), false)
       or exists (select 1 from public.student_portfolios p
                   where p.student_id = _student_id and p.is_public)
     )
   order by s.created_at desc
   limit 100;
$function$;

do $$
declare
  tp constant regprocedure := 'public.tpo_student_profile(uuid)'::regprocedure;
  a1 constant text := 'then ''passed'' else s.status end as status, (select t2.status from public.tasks t2 where t2.id = s.task_id) as task_status,';
  b1 constant text := a1 || ' (select jsonb_build_object(''status'', v.status, ''reason'', v.evaluation ->> ''attempt_fail'', ''score'', v.communication_score) from public.voice_explanations v where v.student_id = p.id and v.task_id = s.task_id and v.withdrawn_at is null order by (v.status = ''scored'') desc, v.created_at desc limit 1) as voice,';
begin
  if position(b1 in pg_get_functiondef(tp)) > 0 then execute replace(pg_get_functiondef(tp), b1, a1); end if;
  if position(b1 in pg_get_functiondef(tp)) > 0 or position('320 (S6)' in pg_get_functiondef('public.my_achievements()'::regprocedure)) > 0
     or pg_get_functiondef('public.portfolio_work(uuid)'::regprocedure) ~ 'dv.status' then
    raise exception '320 rollback self-check failed';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
