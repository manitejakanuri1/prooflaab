-- Rollback of 171: the Lot functions use the database (UTC) date again.
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
    execute format('alter function %s reset timezone', f);
  end loop;
end $$;
commit;
