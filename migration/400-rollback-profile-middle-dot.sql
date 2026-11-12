-- Rollback of 400: puts the bare "?" join back in tpo_student_profile() (exactly what 220 left).
begin;
do $$
declare def text := pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure);
begin
  execute replace(def, 'concat_ws('' ' || chr(183) || ' ''', 'concat_ws('' ? ''');
end $$;
commit;
notify pgrst, 'reload schema';
