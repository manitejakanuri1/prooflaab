-- 68: one student's problem must not stop the daily Lot for everyone (found at 15,000-student scale).
-- assign_todays_lots() created every student's Lot inside one loop with no error handling:
-- a single profile that made create_lot_for() raise (for example a malformed skills array)
-- aborted the whole run and rolled back the Lots already created, so NO student got a Lot.
-- Each student is now handled on their own: a failure is counted, the first error text is
-- kept for the log, and everyone else still gets their Lot.
begin;

create or replace function public.assign_todays_lots()
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  s record; r jsonb;
  made integer := 0; skipped integer := 0; failed integer := 0;
  first_error text; first_failed uuid;
begin
  for s in
    select p.id from public.student_profiles p
     where p.status = 'active'
  loop
    begin
      r := public.create_lot_for(s.id, current_date);
      if coalesce((r->>'created')::boolean, false) then made := made + 1;
      else skipped := skipped + 1; end if;
    exception when others then
      failed := failed + 1;
      if first_error is null then
        first_error := sqlerrm; first_failed := s.id;
      end if;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'lots_created', made, 'already_had_one', skipped,
                            'failed', failed, 'first_error', first_error, 'first_failed_student', first_failed,
                            'ran_at', now());
end $function$;

revoke all on function public.assign_todays_lots() from public, anon, authenticated;
grant execute on function public.assign_todays_lots() to service_role;

do $$
begin
  if pg_get_functiondef('public.assign_todays_lots()'::regprocedure) !~ 'exception when others' then
    raise exception '68 self-check: assign_todays_lots has no per-student error handling';
  end if;
  if has_function_privilege('authenticated', 'public.assign_todays_lots()', 'execute') then
    raise exception '68 self-check: assign_todays_lots is callable from a browser';
  end if;
end $$;

commit;
