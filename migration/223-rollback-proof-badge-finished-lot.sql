-- Rollback for 223.
begin;

CREATE OR REPLACE FUNCTION public.record_activity(_student_id uuid, _metric text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q record; b record; period date;
  have integer; topics integer; proofs integer; streak integer;
begin
  if _student_id is null then return; end if;
  perform set_config('app.system_write', 'on', true);
  perform public.touch_streak(_student_id);
  for q in select * from public.quests where is_active and metric = _metric loop
    period := case when q.cadence = 'daily'
                   then current_date
                   else date_trunc('week', current_date)::date end;
    insert into public.student_quests (student_id, quest_slug, period_start, progress)
    values (_student_id, q.slug, period, 1)
    on conflict (student_id, quest_slug, period_start) do update
      set progress = least(public.student_quests.progress + 1, q.target);
    update public.student_quests sq
       set completed_at = now()
     where sq.student_id = _student_id and sq.quest_slug = q.slug
       and sq.period_start = period and sq.progress >= q.target
       and sq.completed_at is null;
    if found then
      insert into public.xp_logs (student_id, xp_points, source)
      values (_student_id, q.xp_reward, 'quest:' || q.slug);
      update public.student_profiles set total_xp = total_xp + q.xp_reward
       where id = _student_id;
    end if;
  end loop;
  select count(*) into topics from public.student_levels
   where student_id = _student_id and status in ('cleared', 'mastered');
  -- "proof" badges count passed submissions (the proof-upload table is retired).
  select count(*) into proofs from public.task_submissions
   where student_id = _student_id and status = 'passed';
  select coalesce(current_days, 0) into streak from public.student_streaks
   where student_id = _student_id;
  for b in select * from public.badges loop
    have := case b.rule_kind
              when 'level'  then topics
              when 'proof'  then proofs
              when 'streak' then streak
              else 0 end;
    if b.rule_value is not null and have >= b.rule_value then
      insert into public.student_badges (student_id, badge_slug)
      values (_student_id, b.slug)
      on conflict (student_id, badge_slug) do nothing;
    end if;
  end loop;
  perform set_config('app.system_write', 'off', true);
end
$function$;

notify pgrst, 'reload schema';
commit;
