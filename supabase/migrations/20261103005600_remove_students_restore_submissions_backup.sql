-- 106: student removal works again (S34 QA fix-forward for 105). Requires 65, 66, 105.
--
-- WHY. Migration 105 re-created remove_students() from an older body: its backup branch reads
-- public.proof_uploads, which migration 66 dropped, and it no longer keeps task_submissions (migration 65).
-- PostgreSQL plans the whole INSERT, so EVERY removal failed after 105 - a college or an administrator
-- removing a student, the console sync, and a student deleting their own account:
--   ERROR: relation "public.proof_uploads" does not exist
-- Reproduced on PostgreSQL (docs/sidhu-qa/S34-QA-AND-LIVE-E2E.md); 105 is applied on staging.
--
-- NOW. One anchored replacement in the LIVE definition (refused unless found exactly once): the dead
-- 'proofs' entry becomes migration 65's 'submissions' entry. Nothing else in the function, its owner,
-- grants, SECURITY DEFINER or search_path changes (checked below). 105's self-deletion branch is kept.
-- Rollback: none - undoing this breaks every removal again (see the rollback note file).
begin;

create temp table _106_before on commit drop as
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype
    from pg_proc p where p.oid = 'public.remove_students(uuid[],uuid,text)'::regprocedure;

do $$
declare
  f constant regprocedure := 'public.remove_students(uuid[],uuid,text)'::regprocedure;
  dead constant text := '''proofs'',\s*\(select jsonb_agg\(to_jsonb\(x\)\) from public\.proof_uploads x where x\.student_id = s\.student_id\),';
  fixed constant text := '''submissions'', (select jsonb_agg(to_jsonb(x)) from public.task_submissions x where x.student_id = s.student_id),';
  def text := pg_get_functiondef(f);
  n int;
begin
  if position('proof_uploads' in def) = 0 and position('task_submissions' in def) > 0 then
    raise notice '106: remove_students already keeps task_submissions';
    return;
  end if;
  n := regexp_count(def, dead);
  if n <> 1 then
    raise exception '106: expected the proof_uploads backup entry exactly once in remove_students, found %', n;
  end if;
  execute regexp_replace(def, dead, fixed);
end $$;

do $$
declare
  f constant regprocedure := 'public.remove_students(uuid[],uuid,text)'::regprocedure;
  b record; a record; def text := pg_get_functiondef('public.remove_students(uuid[],uuid,text)'::regprocedure);
begin
  select * into b from _106_before;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype into a from pg_proc p where p.oid = f;
  if a.proowner <> b.proowner or a.prosecdef <> b.prosecdef or a.proconfig is distinct from b.proconfig
     or a.acl is distinct from b.acl or a.provolatile <> b.provolatile or a.prorettype <> b.prorettype then
    raise exception '106 self-check: remove_students changed more than its backup entry';
  end if;
  if position('proof_uploads' in def) > 0 or position('task_submissions' in def) = 0 then
    raise exception '106 self-check: remove_students still reads proof_uploads or does not keep task_submissions';
  end if;
  if position('self_requested' in def) = 0 then
    raise exception '106 self-check: 105''s self-deletion branch is missing';
  end if;
  if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
     or not has_function_privilege('service_role', f, 'execute') then
    raise exception '106 self-check: remove_students privileges wrong';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
