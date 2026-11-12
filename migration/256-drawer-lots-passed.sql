-- 256 (owner 12 Nov 2026, assigned-work test item 6): the drawer's "Lots passed" counts distinct Lots passed,
--   the same as the Students list column (tpo_students proofs_verified), not passed tries.
-- Rollback: migration/256-rollback-drawer-lots-passed.sql
begin;
do $$
declare def text := pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure);
  a constant text := '''auto_graded_passed'', (select count(*) from public.task_submissions';
  b constant text := '''auto_graded_passed'', (select count(distinct task_id) from public.task_submissions';
begin
  if position(b in def) = 0 then
    if position(a in def) = 0 then raise exception '256: anchor not found'; end if;
    execute replace(def, a, b);
  end if;
  if position(b in pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure)) = 0 then
    raise exception '256 self-check failed';
  end if;
end $$;
commit;
