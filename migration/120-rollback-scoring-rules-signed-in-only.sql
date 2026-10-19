-- Rollback of 120: signed-out callers can run the scoring-rule functions again.
begin;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('tpo_scoring_rules', 'tpo_set_scoring_weight', 'tpo_reset_scoring_weight')
  loop
    execute format('grant execute on function %s to public, anon', r.sig);
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
