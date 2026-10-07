-- 93: a correct coding submission is "passed" again when its hidden tests are stored as one summary.
--
-- WHY. Migration 91 made status = 'passed' for a sandbox submission need, among other things,
--   jsonb_array_length(_details) = _total_count  (one stored row per test).
-- Release 444b2f3 (B2-A) changed redact(): submit-sandbox-task now stores the visible rows plus ONE
-- {"id":"hidden-summary","hidden_count":N,...} row, so students can no longer read a verdict per
-- hidden test. For any task with 2+ hidden tests the row count is now always smaller than
-- _total_count, so a submission that passes EVERY test is recorded 'failed': no completion, no XP,
-- and the screen says "Needs 80%". Rehearsed on staging 7 Oct 2026 (rolled back): the same student,
-- task and counts (4/4, score 100) gave 'passed' with per-test details and 'failed' with the summary.
--
-- NOW. The length condition counts a hidden-summary row as its hidden_count tests (only when
-- hidden_count is a JSON number; anything else counts as 1 and so cannot match). Everything else in
-- 91's rule stays: score >= pass_threshold, passed_count = total_count, and every stored entry
-- (including the summary, whose "passed" is true only when every hidden test passed) marked passed.
-- Per-test details (rows stored before 444b2f3, or an older functions image) still pass as before.
-- Rows already stored are NOT changed by this file (see the repair query in
-- docs/POST-RELEASE-REMAINING-WORK.md, item P1-PASS).
--
-- HOW. One condition replaced in the live definition (refuses unless found exactly once), so nothing
-- else in the function, its owner, grants, SECURITY DEFINER or search_path can change - checked below.
-- ORDER. After 91 (needs 91's rule). Independent of 92.
-- Rollback: 93-rollback-coding-pass-counts-hidden-summary.sql.
begin;

create temp table _93_before on commit drop as
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype
    from pg_proc p
   where p.oid = 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;

do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  old_rule constant text := E'                 and jsonb_typeof(_details) = ''array'' and jsonb_array_length(_details) = _total_count\n';
  new_rule constant text := E'                 and jsonb_typeof(_details) = ''array''\n'
    || E'                 and (select coalesce(sum(case when d ->> ''id'' = ''hidden-summary'' and jsonb_typeof(d -> ''hidden_count'') = ''number''\n'
    || E'                                               then (d ->> ''hidden_count'')::numeric else 1 end), 0)\n'
    || E'                        from jsonb_array_elements(_details) d) = _total_count\n';
  def text := pg_get_functiondef(f);
  n int;
begin
  if position(new_rule in def) > 0 and position(old_rule in def) = 0 then
    raise notice '93: record_task_submission already counts the hidden summary';
    return;
  end if;
  n := (length(def) - length(replace(def, old_rule, ''))) / length(old_rule);
  if n <> 1 then
    raise exception '93: expected 91''s length rule exactly once in record_task_submission, found % (is 91 applied?)', n;
  end if;
  execute replace(def, old_rule, new_rule);
end $$;

do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  b record; a record;
  def text := pg_get_functiondef(f);
begin
  select * into b from _93_before;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype into a
    from pg_proc p where p.oid = f;
  if a.proowner <> b.proowner or a.prosecdef <> b.prosecdef or a.proconfig is distinct from b.proconfig
     or a.acl is distinct from b.acl or a.provolatile <> b.provolatile or a.prorettype <> b.prorettype then
    raise exception '93 self-check: record_task_submission changed more than its pass rule';
  end if;
  if position('hidden-summary' in def) = 0 or position('_passed_count = _total_count' in def) = 0 then
    raise exception '93 self-check: the every-test rule with the hidden summary is not in record_task_submission';
  end if;
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
    raise exception '93 self-check: record_task_submission is callable by a browser role';
  end if;
end $$;

commit;
