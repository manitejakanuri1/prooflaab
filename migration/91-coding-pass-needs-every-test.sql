-- 91: a coding submission is "passed" (verified correct) only when EVERY test passed.
--
-- WHY. record_task_submission() marked a sandbox submission 'passed' when score >= pass_threshold
-- (usually 80). Code that fails a hidden edge-case test but passes 4 of 5 tests scored 80 and was
-- recorded as passed: the task completed, XP was paid, and every reader of task_submissions.status
-- (Build-Log, portfolio, company and college views, Daily Lot evidence) showed it as verified work.
-- Measured on staging 6 Oct 2026: 6 such rows (5 students) out of 465 passed sandbox submissions.
--
-- NOW. score stays the educational partial score (unchanged, still stored in sandbox_score).
-- status = 'passed' for a sandbox submission additionally needs:
--   total_count > 0, passed_count = total_count, and every entry of details marked passed.
-- Anything less is 'failed' (the same path as a low score: the student can try again).
-- Written (rubric) tasks are unchanged. Rows already stored are NOT changed by this file.
--
-- HOW. One condition replaced in the live definition (refuses unless found exactly once), so nothing
-- else in the function, its owner, grants, SECURITY DEFINER or search_path can change - checked below.
-- ORDER. After 90 (independent of 82b-90). Same function body on staging and production (md5 checked
-- 6 Oct 2026: db592468a6e265aa352bd1fc3e72195b on both).
-- Rollback: 91-rollback-coding-pass-needs-every-test.sql.
begin;

create temp table _91_before on commit drop as
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype
    from pg_proc p
   where p.oid = 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;

do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  old_rule constant text := E'  elsif _score >= pass_threshold then\n    v_status := ''passed'';';
  new_rule constant text := E'  elsif _score >= pass_threshold\n'
    || E'        and (_sandbox_config_id is null\n'
    || E'             or (_total_count > 0 and _passed_count = _total_count\n'
    || E'                 and jsonb_typeof(_details) = ''array'' and jsonb_array_length(_details) = _total_count\n'
    || E'                 and not exists (select 1 from jsonb_array_elements(_details) d\n'
    || E'                                  where (d ->> ''passed'') is distinct from ''true''))) then\n'
    || E'    v_status := ''passed'';';
  def text := pg_get_functiondef(f);
  n int;
begin
  if position(new_rule in def) > 0 and position(old_rule in def) = 0 then
    raise notice '91: record_task_submission already needs every test';
    return;
  end if;
  n := (length(def) - length(replace(def, old_rule, ''))) / length(old_rule);
  if n <> 1 then
    raise exception '91: expected the pass rule exactly once in record_task_submission, found %', n;
  end if;
  execute replace(def, old_rule, new_rule);
end $$;

do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  b record; a record;
begin
  select * into b from _91_before;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype into a
    from pg_proc p where p.oid = f;
  if a.proowner <> b.proowner or a.prosecdef <> b.prosecdef or a.proconfig is distinct from b.proconfig
     or a.acl is distinct from b.acl or a.provolatile <> b.provolatile or a.prorettype <> b.prorettype then
    raise exception '91 self-check: record_task_submission changed more than its pass rule';
  end if;
  if position('_passed_count = _total_count' in pg_get_functiondef(f)) = 0 then
    raise exception '91 self-check: the every-test rule is not in record_task_submission';
  end if;
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
    raise exception '91 self-check: record_task_submission is callable by a browser role';
  end if;
end $$;

commit;
