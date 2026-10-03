-- 75: the nightly Lot job says plainly how it went (G6).
-- After migration 68 a run in which EVERY student failed still answered ok:true (with
-- failed: 15000 beside it). The result now carries a status:
--   success          no student failed
--   partial_failure  some failed, but fewer than 5% of the students handled and fewer than 50
--   failure          5% or more, or 50 or more, or nobody could be handled at all
-- `ok` is true only for success and partial_failure. The scheduled-job function answers
-- HTTP 500 on failure, so Cloud Scheduler retries it and the "scheduled job failed" alert fires.
-- Per-student isolation (68) is unchanged: one bad profile never stops the others.
begin;

create or replace function public.assign_todays_lots()
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  s record; r jsonb;
  made integer := 0; skipped integer := 0; failed integer := 0; handled integer;
  first_error text; first_failed uuid; state text;
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
  handled := made + skipped + failed;
  state := case
    when failed = 0 then 'success'
    when failed >= 50 or failed::numeric / greatest(handled, 1) >= 0.05 then 'failure'
    else 'partial_failure' end;
  return jsonb_build_object('ok', state <> 'failure', 'status', state,
                            'lots_created', made, 'already_had_one', skipped,
                            'failed', failed, 'students', handled,
                            'first_error', first_error, 'first_failed_student', first_failed,
                            'ran_at', now());
end $function$;

revoke all on function public.assign_todays_lots() from public, anon, authenticated;
grant execute on function public.assign_todays_lots() to service_role;

do $$
begin
  if pg_get_functiondef('public.assign_todays_lots()'::regprocedure) !~ 'partial_failure' then
    raise exception '75 self-check: assign_todays_lots does not report a status';
  end if;
  if has_function_privilege('authenticated', 'public.assign_todays_lots()', 'execute') then
    raise exception '75 self-check: assign_todays_lots is callable from a browser';
  end if;
end $$;

commit;
