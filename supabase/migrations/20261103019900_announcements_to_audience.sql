-- 199 (MF-033, owner 31 Oct 2026): an announcement goes to the people the admin picks.
--   announcements.audience: all / students / colleges / companies (default all).
--   When an announcement is published, every account in that audience gets one bell notice (once per
--   announcement, dedupe_key). my_announcements() returns the live ones for the signed-in person's role,
--   for the banner on their dashboard. Drafts and expired ones are never shown.
-- Rollback: migration/199-rollback-announcements-to-audience.sql
begin;

alter table public.announcements
  add column if not exists audience text not null default 'all'
  check (audience in ('all', 'students', 'colleges', 'companies'));

create or replace function public.announcement_role_matches(_audience text, _role text)
returns boolean language sql immutable as $fn$
  select _audience = 'all'
      or (_audience = 'students'  and _role = 'student')
      or (_audience = 'colleges'  and _role = 'college_admin')
      or (_audience = 'companies' and _role = 'startup');
$fn$;

create or replace function public.announcement_fan_out()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and (new.expiry_date is null or new.expiry_date > now()) then
    insert into public.notifications (user_id, audience, source, type, title, message, link, dedupe_key)
    select distinct on (ur.user_id) ur.user_id,
           case ur.role when 'student' then 'student' when 'college_admin' then 'college' else 'company' end,
           'system', 'announcement', new.title, left(coalesce(new.description, ''), 300),
           case ur.role when 'student' then '/student/dashboard'
                        when 'college_admin' then '/college/dashboard' else '/company/dashboard' end,
           'announcement-' || new.id
      from public.user_roles ur
     where ur.role <> 'admin' and public.announcement_role_matches(new.audience, ur.role::text)
    on conflict do nothing;
  end if;
  return new;
end $fn$;
revoke all on function public.announcement_fan_out() from public, anon, authenticated;

drop trigger if exists announcement_fan_out on public.announcements;
create trigger announcement_fan_out after insert or update of status on public.announcements
  for each row execute function public.announcement_fan_out();

create or replace function public.my_announcements()
returns table(id uuid, title text, description text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select a.id, a.title, a.description, a.created_at
    from public.announcements a
   where a.status = 'published' and (a.expiry_date is null or a.expiry_date > now())
     and exists (select 1 from public.user_roles ur
                  where ur.user_id = (select auth.uid())
                    and public.announcement_role_matches(a.audience, ur.role::text))
   order by a.created_at desc
   limit 3;
$fn$;
revoke all on function public.my_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated;

do $$ begin
  if not public.announcement_role_matches('students', 'student')
     or public.announcement_role_matches('companies', 'student') then
    raise exception '199 self-check: audience match is wrong';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
