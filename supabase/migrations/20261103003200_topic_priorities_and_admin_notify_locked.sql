-- 82: the two D1b functions flagged on 4 Oct.
--  * topic_priorities(_student_id) returned any student's topic ratings to ANY caller, including an
--    anonymous one (proven on staging with synthetic students). It now answers only for: the student
--    themself, an admin, the approved college that owns the student, or the backend (service_role).
--    The caller is derived from auth.uid() and the existing helpers is_admin() and
--    college_owns_student(); the caller-provided _student_id is never trusted alone.
--  * notify_all_admins(...) let ANY caller, including an anonymous one, write a notification with any
--    text to every admin (proven inside a rolled-back transaction). Nothing in the app calls it, so it
--    is now backend-only (service_role) and also refuses inside unless the caller is the backend or
--    an admin.
begin;

create or replace function public.topic_priorities(_student_id uuid, _limit integer default 10)
returns table(topic text, rating integer, confidence numeric, days_since numeric, score numeric)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if not (
       auth.role() = 'service_role'
    or public.is_admin()
    or exists (select 1 from public.student_profiles sp where sp.id = _student_id and sp.user_id = auth.uid())
    or exists (select 1 from public.student_profiles sp where sp.id = _student_id and public.college_owns_student(sp.college_id))
  ) then
    raise exception 'not allowed to read this student''s topic priorities' using errcode = '42501';
  end if;
  return query
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
end $function$;

revoke all on function public.topic_priorities(uuid, integer) from public, anon;
grant execute on function public.topic_priorities(uuid, integer) to authenticated, service_role;

create or replace function public.notify_all_admins(_title text, _message text, _type text default 'system', _link text default null)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'only the backend or an admin may notify all admins' using errcode = '42501';
  end if;
  insert into public.notifications (user_id, actor_id, type, title, message, link, source, audience)
  select ur.user_id, auth.uid(), _type, _title, _message, _link, 'system', 'admin'
  from public.user_roles ur where ur.role = 'admin';
end $function$;

revoke all on function public.notify_all_admins(text, text, text, text) from public, anon, authenticated;
grant execute on function public.notify_all_admins(text, text, text, text) to service_role;

-- Self-checks: privileges, then behaviour (inside this transaction; nothing persists).
do $$
declare a record; b record; ok boolean;
begin
  if has_function_privilege('anon', 'public.topic_priorities(uuid,integer)', 'execute') then raise exception '82: anon can run topic_priorities'; end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = 'public.topic_priorities(uuid,integer)'::regprocedure and x.grantee = 0) then raise exception '82: PUBLIC can run topic_priorities'; end if;
  if has_function_privilege('anon', 'public.notify_all_admins(text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.notify_all_admins(text,text,text,text)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = 'public.notify_all_admins(text,text,text,text)'::regprocedure and x.grantee = 0) then
    raise exception '82: notify_all_admins is still callable by PUBLIC/anon/authenticated';
  end if;

  -- Behaviour: a signed-in student asking for ANOTHER student's priorities must be refused.
  select sp.id, sp.user_id into a from public.student_profiles sp where sp.user_id is not null order by sp.id limit 1;
  select sp.id into b from public.student_profiles sp where sp.user_id is not null and sp.user_id <> a.user_id
     and not exists (select 1 from public.user_roles ur where ur.user_id = a.user_id and ur.role = 'admin') order by sp.id limit 1;
  if a.id is not null and b.id is not null and not exists (select 1 from public.user_roles ur where ur.user_id = a.user_id and ur.role = 'admin') then
    perform set_config('request.jwt.claims', json_build_object('sub', a.user_id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    ok := false;
    begin
      perform * from public.topic_priorities(b.id, 1);
    exception when insufficient_privilege then ok := true;
    end;
    -- and their own must still work
    perform * from public.topic_priorities(a.id, 1);
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    if not ok then raise exception '82: a student could read another student''s topic priorities'; end if;
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
