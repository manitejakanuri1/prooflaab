-- ROLLBACK 84a: put back the original "<>" comparison. Only valid before 85 runs, or together with rolling
-- back 85 (85's rule would otherwise be false again). Does nothing where the functions do not exist.
begin;
do $$
declare
  fixes constant text[][] := array[
    ['public.cosignable_proofs()',               'theirs.student_id is distinct from (select auth.uid())', 'theirs.student_id <> (select auth.uid())'],
    ['public.set_proof_publicity(uuid,boolean)', 'if owner is distinct from auth.uid() then',              'if owner <> auth.uid() then']];
  i int; f regprocedure; def text;
begin
  for i in 1 .. array_length(fixes, 1) loop
    f := to_regprocedure(fixes[i][1]);
    if f is null then continue; end if;
    def := pg_get_functiondef(f);
    if position(fixes[i][2] in def) = 0 then continue; end if;
    execute replace(def, fixes[i][2], fixes[i][3]);
  end loop;
end $$;
commit;
