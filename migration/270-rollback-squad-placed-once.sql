-- Rollback 270: the notice fires on every squad_members insert again (migration stage33 version).
begin;
create or replace function public.notify_squad_placement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare squad_name text;
begin
  select name into squad_name from public.squads where id = new.squad_id;
  if squad_name is null then return null; end if;
  insert into public.notifications
    (user_id, audience, source, type, title, message, link)
  values (new.student_id, 'student', 'system', 'squad_placed',
          'You are in ' || squad_name,
          'Your squad competes every week. Everything you finish - lots, ' ||
          'explanations, topics - adds to its score.',
          '/student/dashboard');
  return null;
end $fn$;
notify pgrst, 'reload schema';
commit;
