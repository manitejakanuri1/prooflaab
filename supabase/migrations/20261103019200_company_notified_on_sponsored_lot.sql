-- 192 (MF-088): companies had no notifications at all, so a bell would always be empty. A company is now
-- told when a student finishes a Lot the company set. The company dashboard shows a bell (useNotifications,
-- same notifications table and own-row policies as every other role).
begin;
create or replace function public.notify_company_sponsored_done()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare who text;
begin
  select sp.full_name into who from public.student_profiles sp
   where sp.id = new.student_id or sp.user_id = new.student_id limit 1;
  insert into public.notifications (user_id, audience, source, type, title, message, link)
  values (new.sponsored_by, 'company', 'system', 'sponsored_task_done',
          coalesce(who, 'A student') || ' finished your Lot',
          '"' || left(new.title, 80) || '" is done. Open Lots to review the work.',
          '/company/dashboard');
  return new;
end $fn$;
revoke all on function public.notify_company_sponsored_done() from public, anon, authenticated;

drop trigger if exists tasks_notify_company_done on public.tasks;
create trigger tasks_notify_company_done
  after update of status on public.tasks
  for each row
  when (new.sponsored_by is not null and new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.notify_company_sponsored_done();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tasks_notify_company_done') then
    raise exception '192: trigger missing';
  end if;
end $$;
commit;
