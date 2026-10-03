-- 76: the nightly Lot job works through students in batches (found at 15,000 students).
-- assign_todays_lots() handled every student in ONE database request. The API ends any
-- request after 30 seconds (staging and production), so past roughly ten thousand students
-- the whole run was cut off and rolled back: nobody got a Lot.
-- assign_todays_lots_batch(_after, _limit) handles the next _limit active students after id
-- _after (in id order) and reports where it stopped. The scheduled-job function calls it
-- until `done`, adds the counts up and decides success / partial_failure / failure with the
-- same thresholds as migration 75. Each batch is its own short transaction, so what one
-- batch created stays created even if a later batch fails. Per-student isolation is kept.
begin;

create or replace function public.assign_todays_lots_batch(_after uuid default null, _limit integer default 1000)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  s record; r jsonb;
  made integer := 0; skipped integer := 0; failed integer := 0; n integer := 0;
  first_error text; first_failed uuid; last_id uuid := _after;
  lim integer := greatest(1, least(coalesce(_limit, 1000), 5000));
begin
  for s in
    select p.id from public.student_profiles p
     where p.status = 'active' and (_after is null or p.id > _after)
     order by p.id
     limit lim
  loop
    n := n + 1; last_id := s.id;
    begin
      r := public.create_lot_for(s.id, current_date);
      if coalesce((r->>'created')::boolean, false) then made := made + 1;
      else skipped := skipped + 1; end if;
    exception when others then
      failed := failed + 1;
      if first_error is null then first_error := sqlerrm; first_failed := s.id; end if;
    end;
  end loop;
  return jsonb_build_object('lots_created', made, 'already_had_one', skipped, 'failed', failed,
                            'students', n, 'last_id', last_id, 'done', n < lim,
                            'first_error', first_error, 'first_failed_student', first_failed);
end $function$;

revoke all on function public.assign_todays_lots_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.assign_todays_lots_batch(uuid, integer) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.assign_todays_lots_batch(uuid, integer)', 'execute') then
    raise exception '76 self-check: the batch function is callable from a browser';
  end if;
  if not has_function_privilege('service_role', 'public.assign_todays_lots_batch(uuid, integer)', 'execute') then
    raise exception '76 self-check: the server cannot call the batch function';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
