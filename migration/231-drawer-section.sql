-- 231 (overnight TEST 12 Nov 2026, item 5): the college student drawer showed no section (the list did).
--   tpo_student_profile now also returns 'cohort' (the student's section, e.g. CSE-A). Keeps 230's India time zone.
-- Rollback: migration/231-rollback-drawer-section.sql
begin;
do $$
declare def text := pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure);
begin
  if position('''cohort'', p.cohort' in def) = 0 then
    if position('''branch'', p.branch,' in def) = 0 then raise exception '231: anchor not found'; end if;
    execute replace(def, '''branch'', p.branch,', '''branch'', p.branch, ''cohort'', p.cohort,');
  end if;
  if position('''cohort'', p.cohort' in pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure)) = 0 then
    raise exception '231 self-check: cohort missing';
  end if;
end $$;
commit;
