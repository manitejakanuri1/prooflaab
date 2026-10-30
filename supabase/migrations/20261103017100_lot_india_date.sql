-- 171 (MF-124, 30 Oct 2026): Daily Lot functions use the India date, not the database's UTC date.
--   The database clock is UTC, so between 00:00 and 05:30 IST current_date was still "yesterday": the Lot made
--   or shown in that window carried the wrong day. Each Lot function now runs with TimeZone = Asia/Kolkata,
--   so current_date / now()::date inside it are the India date. Nothing else in the database changes.
--   NOTE: a later CREATE OR REPLACE of one of these functions must keep "set timezone to 'Asia/Kolkata'".
-- Rollback: migration/171-rollback-lot-india-date.sql
begin;

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('admin_daily_lots', 'assign_todays_lots', 'assign_todays_lots_batch', 'company_create_lot',
                         'create_lot_for', 'create_my_lot', 'my_todays_lot', 'my_week', 'next_lot_pick',
                         'plan_student_week', 'lot_state', 'lot_submit', 'my_lot_state', 'submit_my_lot',
                         'my_marks_week')
  loop
    execute format('alter function %s set timezone to %L', f, 'Asia/Kolkata');
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('assign_todays_lots', 'create_my_lot', 'my_todays_lot', 'next_lot_pick')
                and not coalesce(p.proconfig, '{}') @> array['TimeZone=Asia/Kolkata']) then
    raise exception '171: a Lot function still uses the UTC date';
  end if;
end $$;

commit;
