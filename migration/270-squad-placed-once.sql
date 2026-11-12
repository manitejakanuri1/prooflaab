-- 270 (student E2E 12 Nov 2026, item 7): "You are in <squad>" only when the squad actually changes.
--   Each new season re-seats the same squads (carry_over_squads inserts new squad_members rows), and the
--   squad_members trigger sent "You are in CSE-A Titans 3" again every time: on TEST (2-hour seasons) about
--   12 a day per student - 80 of Student 05's 84 unread. Now the notice is skipped when the student's latest
--   squad notice already names the same squad. A real move to another squad still notifies. No rows deleted.
begin;
create or replace function public.notify_squad_placement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare squad_name text; last_title text;
begin
  select name into squad_name from public.squads where id = new.squad_id;
  if squad_name is null then return null; end if;

  -- same squad as the last notice (a new season carrying the squad over) = nothing new to say
  select n.title into last_title from public.notifications n
   where n.user_id = new.student_id and n.type = 'squad_placed'
   order by n.created_at desc limit 1;
  if last_title is not distinct from 'You are in ' || squad_name then return null; end if;

  insert into public.notifications
    (user_id, audience, source, type, title, message, link)
  values (new.student_id, 'student', 'system', 'squad_placed',
          'You are in ' || squad_name,
          'Your squad competes every week. Everything you finish - lots, ' ||
          'explanations, topics - adds to its score.',
          '/student/dashboard');
  return null;
end $fn$;

do $$
begin
  if position('last_title is not distinct from' in pg_get_functiondef('public.notify_squad_placement'::regproc)) = 0 then
    raise exception '270 self-check: guard missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'squad_members_notify') then
    raise exception '270 self-check: trigger squad_members_notify missing';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
