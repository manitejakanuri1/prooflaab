-- 320 (owner E2E 12 Nov 2026, Students 08/09; items S6, Y1, Y2). Display and counting only - no mark or pass line changes.
--   S6) Done = a passing answer + an accepted (scored, not withdrawn) voice - the dashboard's rule (lot_marks).
--       my_achievements: quest "Today's Lot" / "Five Lots" (metric lot_submitted) counted any handed-in answer, even a
--         1.9/10 one with no voice. It now counts Lots that are done, on the day the voice was accepted.
--         "Say It Out Loud" (voice_recorded) counted rejected recordings too; now accepted ones only.
--         Quest descriptions say so.
--       portfolio_work: listed a passed Lot whose voice was rejected ("Not explained yet") and counted it in
--         "Completed Tasks". Now only done Lots are listed. The voice score is read by task (it was by submission, so a
--         voice recorded after a retry showed as missing); it is still sent only when 50+ (migration 158).
--   Y1/Y2) tpo_student_profile recent_work: each Lot now carries its voice ({status, reason, score}; an accepted
--       recording wins, else the newest), so the college/admin drawer reads the same line as the student
--       ("Passed · 10/10 · voice not accepted - off topic") instead of "voice owed".
-- Rollback: migration/320-rollback-done-rule-and-voice-status.sql
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
            -- 320 (S6): a Lot is done = passing answer + accepted voice; it counts on the day the voice was accepted.
            when 'lot_submitted' then (select count(distinct t.id) from public.tasks t
                                        where t.lot_date is not null
                                          and exists (select 1 from public.task_submissions s
                                                       where s.task_id = t.id and s.student_id = me and s.status = 'passed')
                                          and exists (select 1 from public.voice_explanations v
                                                       where v.task_id = t.id and v.student_id = me
                                                         and v.status = 'scored' and v.withdrawn_at is null
                                                         and (v.created_at at time zone 'Asia/Kolkata')::date >= case q.cadence when 'daily' then today else monday end))
            when 'voice_recorded' then (select count(*) from public.voice_explanations v
                                        where v.student_id = me and v.status = 'scored' and v.withdrawn_at is null
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

update public.quests set description = 'Finish the Lot on your Daily Card: a passing answer and an accepted 60-second voice.' where slug = 'daily-lot';
update public.quests set description = 'Finish five daily Lots this week: a passing answer and an accepted voice each.' where slug = 'weekly-five-lots';
update public.quests set description = 'Get one 60-second explanation of your own work accepted.' where slug = 'daily-explain';

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
           where v.task_id = s.task_id and v.student_id = s.student_id
             and v.status = 'scored' and v.withdrawn_at is null and v.communication_score >= 50
           order by v.current_authoritative desc, v.created_at desc limit 1),
         (select st.name from public.startups st where st.user_id = t.sponsored_by)
    from public.task_submissions s
    join public.tasks t on t.id = s.task_id
   where s.student_id = _student_id
     and s.status = 'passed'
     and s.created_at = (select max(l.created_at) from public.task_submissions l
                          where l.task_id = s.task_id and l.student_id = s.student_id and l.status = 'passed')
     -- 320 (S6): only done Lots - the voice was accepted too.
     and exists (select 1 from public.voice_explanations dv
                  where dv.task_id = s.task_id and dv.student_id = s.student_id
                    and dv.status = 'scored' and dv.withdrawn_at is null)
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
  def text;
  a1 constant text := 'then ''passed'' else s.status end as status, (select t2.status from public.tasks t2 where t2.id = s.task_id) as task_status,';
  b1 constant text := a1 || ' (select jsonb_build_object(''status'', v.status, ''reason'', v.evaluation ->> ''attempt_fail'', ''score'', v.communication_score) from public.voice_explanations v where v.student_id = p.id and v.task_id = s.task_id and v.withdrawn_at is null order by (v.status = ''scored'') desc, v.created_at desc limit 1) as voice,';
begin
  def := pg_get_functiondef(tp);
  if position(b1 in def) = 0 then
    if position(a1 in def) = 0 then raise exception '320: tpo_student_profile anchor not found'; end if;
    execute replace(def, a1, b1);
  end if;
  if position(b1 in pg_get_functiondef(tp)) = 0 then raise exception '320 self-check: tpo_student_profile'; end if;
  if pg_get_functiondef('public.portfolio_work(uuid)'::regprocedure) !~ 'dv.status = ''scored'' and dv.withdrawn_at is null'
     or pg_get_functiondef('public.portfolio_work(uuid)'::regprocedure) !~ 'communication_score >= 50' then
    raise exception '320 self-check: portfolio_work';
  end if;
  if position('320 (S6)' in pg_get_functiondef('public.my_achievements()'::regprocedure)) = 0 then
    raise exception '320 self-check: my_achievements';
  end if;
  if (select count(*) from public.quests where slug in ('daily-lot', 'weekly-five-lots', 'daily-explain') and description ~ 'accepted') <> 3 then
    raise exception '320 self-check: quest descriptions';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
