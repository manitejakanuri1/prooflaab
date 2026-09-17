-- Two screens found broken by a signed-in browser walk on 17 Sep 2026.
begin;

-- 1. "This week" on a student's Roadmap.
-- my_week() has failed for every student since stage68: the planner writes
-- reason_code 'ladder', but the table's check still only allows the four codes
-- from stage21, so every call raised 23514. ThisWeekPlan.tsx already shows an
-- unknown code as "next", so allowing the value is the whole fix.
alter table public.student_week_plan
  drop constraint student_week_plan_reason_code_check;
alter table public.student_week_plan
  add constraint student_week_plan_reason_code_check
  check (reason_code in ('retry', 'revise', 'next', 'stretch', 'ladder'));

-- 2. Admin > System Settings & Roles.
-- 02-google-catchup recreated the admin_users view with a grant to service_role
-- only, on the belief that the screen reads it through a function. It does not:
-- SystemSettings.tsx reads and writes the view directly, so the screen got 403.
-- Same break stage59 repaired once on Supabase; same reasoning why it is safe:
-- the view filters on is_admin(), and every write goes through admin_users_write,
-- which raises unless is_admin().
grant select, insert, update, delete on public.admin_users to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'student_week_plan_reason_code_check'
       and pg_get_constraintdef(oid) like '%ladder%'
  ) then
    raise exception 'reason_code check still rejects ladder';
  end if;

  if pg_get_viewdef('public.admin_users'::regclass) not like '%is_admin()%' then
    raise exception 'admin_users lost its is_admin() filter - do not grant it to authenticated';
  end if;

  if not has_table_privilege('authenticated', 'public.admin_users', 'SELECT') then
    raise exception 'authenticated still cannot read admin_users';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.admin_users'::regclass
                  and not tgisinternal) then
    raise notice 'admin_users has no INSTEAD OF trigger: listing admins works, adding/removing does not';
  end if;
end $$;

commit;
