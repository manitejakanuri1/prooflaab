-- 209 (owner 1 Nov 2026, for Grok's end-to-end test): TEST ONLY. NEVER apply to REAL.
-- A "test date" an admin can set on the TEST website (Admin > Squads > Test clock).
--   1. public.test_clock: one row; when set, test_now() = the chosen time + the time passed since it was set.
--      No row = the real time. test_today() = test_now() as a date in the caller's time zone (same as current_date).
--   2. Everything that decides "today" by the day reads it: daily Lot creation (05:40 job and dashboard open),
--      the rest day (130), the week plan, streaks, company Lot dates and due dates, Admin > Daily Lots.
--      Season and match timing stay on the 20-minute fast clock (208): moving those by a day would end the
--      season at once, and submission times (real) would no longer fall inside the match weeks.
--   3. admin_test_clock_set(_at) (null = back to real time), admin_test_clock(), admin_test_make_lots().
-- Refuses to run unless the TEST admin login exists (same guard as 197/208). REMOVE with 197 and 208 after
-- Grok's testing: migration/209-rollback-test-clock-date.sql
begin;

do $$ begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception '209 is TEST-only';
  end if;
end $$;

create table if not exists public.test_clock (
  id boolean primary key default true check (id),
  set_to timestamptz not null,
  set_at timestamptz not null default now()
);
alter table public.test_clock enable row level security;

create or replace function public.test_now() returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((select c.set_to + (now() - c.set_at) from public.test_clock c), now());
$fn$;

-- No time zone of its own: like current_date, it uses the caller's (Asia/Kolkata in the Lot functions).
create or replace function public.test_today() returns date
language sql stable security definer set search_path = public, pg_temp as $fn$
  select (public.test_now() at time zone current_setting('TimeZone'))::date;
$fn$;

do $$
declare f record; def text; n int := 0;
begin
  for f in select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('assign_todays_lots', 'assign_todays_lots_batch', 'create_lot_for', 'create_my_lot',
                                'my_todays_lot', 'my_week', 'next_lot_pick', 'plan_student_week', 'admin_daily_lots',
                                'touch_streak', 'record_activity', 'company_create_lot')
              and p.prosrc !~ 'test_(now|today)\(\)' loop
    def := pg_get_functiondef(f.oid);
    def := regexp_replace(def, '\mcurrent_date\M', 'public.test_today()', 'g');
    def := regexp_replace(def, '\mnow\(\)', 'public.test_now()', 'g');
    execute def;
    n := n + 1;
  end loop;
  if n < 12 then raise exception '209: only % date functions changed', n; end if;
end $$;

create or replace function public.admin_test_clock() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object('test_now', public.test_now(), 'real_now', now(),
                            'set', exists (select 1 from public.test_clock));
end $fn$;

create or replace function public.admin_test_clock_set(_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'TEST only';
  end if;
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.test_clock;
  if _at is not null then insert into public.test_clock (set_to) values (_at); end if;
  return public.admin_test_clock();
end $fn$;

-- "Make today's Lots now" for PRAGATI: the same create_lot_for the 05:40 job runs, for the test date.
create or replace function public.admin_test_make_lots() returns jsonb
language plpgsql security definer set search_path = public, pg_temp set "TimeZone" to 'Asia/Kolkata' as $fn$
declare s record; r jsonb; made int := 0; had int := 0; other jsonb := '[]'::jsonb; d date := public.test_today();
begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'TEST only';
  end if;
  if not public.is_admin() then raise exception 'admins only'; end if;
  for s in select p.id from public.student_profiles p join public.colleges c on c.id = p.college_id
            where c.name = 'PRAGATI' and p.status = 'active' loop
    begin
      r := public.create_lot_for(s.id, d);
      if exists (select 1 from public.tasks t where t.student_id = s.id and t.lot_date = d
                  and t.created_at > now() - interval '2 minutes') then made := made + 1;
      elsif exists (select 1 from public.tasks t where t.student_id = s.id and t.lot_date = d) then had := had + 1;
      else other := other || jsonb_build_object('student_id', s.id, 'result', r);
      end if;
    exception when others then
      other := other || jsonb_build_object('student_id', s.id, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('date', d, 'made', made, 'already_had', had, 'none', jsonb_array_length(other),
                            'details', other);
end $fn$;

revoke all on function public.admin_test_clock() from public, anon;
revoke all on function public.admin_test_clock_set(timestamptz) from public, anon;
revoke all on function public.admin_test_make_lots() from public, anon;
grant execute on function public.admin_test_clock() to authenticated;
grant execute on function public.admin_test_clock_set(timestamptz) to authenticated;
grant execute on function public.admin_test_make_lots() to authenticated;

do $$ declare src text; begin
  select prosrc into src from pg_proc where proname = 'create_lot_for' and pronamespace = 'public'::regnamespace;
  if src !~ 'test_today\(\)' then raise exception '209 self-check: create_lot_for still on the real date'; end if;
  if public.test_now() is null then raise exception '209 self-check: test_now() is null'; end if;
end $$;

notify pgrst, 'reload schema';
commit;
