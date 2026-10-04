-- UNSAFE EMERGENCY ROLLBACK of 82.
-- This RESTORES THE OLD EXPOSURE: anyone (even anonymous) could read any student's topic priorities
-- and write notifications to every admin. Use only if 82 broke a legitimate flow, and re-apply a
-- corrected 82 straight after.
begin;

create or replace function public.topic_priorities(_student_id uuid, _limit integer default 10)
returns table(topic text, rating integer, confidence numeric, days_since numeric, score numeric)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with mine as (
    select l.skill as topic,
           coalesce(r.rating, 1200)     as rating,
           coalesce(r.confidence, 0)    as confidence,
           case when r.last_seen is null then 999
                else extract(epoch from (now() - r.last_seen)) / 86400 end as days_since
      from public.levels l
      left join public.topic_ratings r
        on r.student_id = _student_id and r.topic = l.skill
     group by l.skill, r.rating, r.confidence, r.last_seen
  )
  select m.topic, m.rating, m.confidence, round(m.days_since, 1),
         round(
           0.60 * ((2200 - m.rating)::numeric / 1400 * (1 - m.confidence * 0.5))
           + 0.20 * least(m.days_since / 30, 1)
           + 0.10 * case when m.confidence = 0 then 1 else 0 end
           , 4) as score
    from mine m
   order by score desc, m.topic
   limit greatest(_limit, 1);
$function$;
grant execute on function public.topic_priorities(uuid, integer) to public;

create or replace function public.notify_all_admins(_title text, _message text, _type text default 'system', _link text default null)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  insert into public.notifications (user_id, actor_id, type, title, message, link, source, audience)
  select ur.user_id, auth.uid(), _type, _title, _message, _link, 'system', 'admin'
  from public.user_roles ur where ur.role = 'admin';
end $function$;
grant execute on function public.notify_all_admins(text, text, text, text) to public;

commit;
notify pgrst, 'reload schema';
