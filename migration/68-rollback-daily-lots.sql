-- Rollback of 68: assign_todays_lots() as it was (no per-student error handling).
CREATE OR REPLACE FUNCTION public.assign_todays_lots()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s record; made integer := 0; skipped integer := 0; r jsonb;
begin
  for s in
    select p.id from public.student_profiles p
     where p.status = 'active'
  loop
    r := public.create_lot_for(s.id, current_date);
    if coalesce((r->>'created')::boolean, false) then made := made + 1;
    else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'lots_created', made, 'already_had_one', skipped,
                            'ran_at', now());
end $function$;
