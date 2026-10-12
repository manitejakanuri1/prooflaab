-- 108: squads below eleven are filled from the reserve safely, every night (Sidhu S39).
--
-- form_squads() already seats unplaced students in the existing squads of their own section, up to eleven, before
-- it draws new squads (migration 59). It is run by the nightly job (form_all_colleges, 05:35 IST), after every
-- import, and by the college's Generate button. Three defects stopped it from doing that job:
--
--   1. It also picked LOCKED squads. The membership guard refuses a locked squad, so the whole run for that
--      college failed: nobody in the college was placed, every night.
--   2. form_all_colleges() swallowed that failure (a NOTICE nobody sees) and reported ok with 0 placed.
--   3. It ignored the squad's own seat limit (max_members): a squad the college set to nine was filled to eleven.
--      Two runs at the same moment (nightly job, import, button) could also collide on the same student and fail.
--
-- What changes, and nothing else:
--   * form_squads: one run per college at a time (transaction advisory lock); a vacancy is filled only in a squad
--     of the same college, season and section that is not locked or archived, up to the smaller of eleven and its
--     own limit (the twelfth seat stays for the college's Assign); a student placed meanwhile by someone else is
--     skipped instead of failing the run. Three anchored edits in the LIVE definition, each refused unless found
--     exactly once. The drawing of new squads is unchanged.
--   * form_all_colleges: counts the colleges that failed and says so (status 'partial_failure', colleges_failed,
--     first_error). The other colleges still run.
--   Unchanged: Assign (assign_to_squad), Rebalance, Create squad, scoring, matches, seasons, membership history.
--   Policy unchanged: fewer than eleven unplaced students with no squad to join still wait for the college.
-- Rollback: 108-rollback-squad-vacancies-fill-safely.sql (restores both functions as migration 59 / stage 33 left them).
begin;

create temp table _108_before on commit drop as
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl
    from pg_proc p where p.oid = 'public.form_squads(uuid,uuid)'::regprocedure;

do $$
declare
  f constant regprocedure := 'public.form_squads(uuid,uuid)'::regprocedure;
  def text := pg_get_functiondef(f);
  -- The anchors match the text of migration 59, whatever the line endings or indentation.
  lock_at constant text := $r$(\n[[:space:]]*)(sid := coalesce\(_season_id, public\.ensure_season\(_college_id\)\);)$r$;
  target constant text := $r$where s\.season_id = sid and s\.archived_at is null([[:space:]]+)and coalesce\(s\.cohort, 'GENERAL'\) = co\.cohort([[:space:]]+)and \(select count\(\*\) from public\.squad_members m([[:space:]]+)where m\.squad_id = s\.id and m\.left_at is null\) < 11$r$;
  seat constant text := $r$insert into public\.squad_members \(squad_id, student_id, joined_at\)([[:space:]]+)values \(target, stu\.id, now\(\)\);([[:space:]]+)placed := placed \+ 1;([[:space:]]+)filled := filled \+ 1;$r$;
  n int;
begin
  if position('-- 108:' in def) > 0 then
    raise notice '108: form_squads already fills vacancies safely';
    return;
  end if;
  foreach n in array array[
    (select count(*) from regexp_matches(def, lock_at, 'g')),
    (select count(*) from regexp_matches(def, target, 'g')),
    (select count(*) from regexp_matches(def, seat, 'g'))] loop
    if n <> 1 then
      raise exception '108: form_squads is not the migration 59 version (an anchor was found % times)', n;
    end if;
  end loop;
  def := regexp_replace(def, lock_at,
    $r$\1-- 108: one formation per college at a time (nightly job, import and the Generate button can overlap).\1perform pg_advisory_xact_lock(hashtext('prooflab.squads'), hashtext(_college_id::text));\1\2$r$);
  def := regexp_replace(def, target,
    $r$where s.season_id = sid and s.archived_at is null\1and s.college_id = _college_id and not s.is_locked -- 108: a locked squad is the college's to fill\1and coalesce(s.cohort, 'GENERAL') = co.cohort\2and (select count(*) from public.squad_members m\3where m.squad_id = s.id and m.left_at is null) < least(11, s.max_members)$r$);
  def := regexp_replace(def, seat,
    $r$begin -- 108: placed meanwhile (for example by Assign): skip this student, never fail the run\2  insert into public.squad_members (squad_id, student_id, joined_at)\1  values (target, stu.id, now());\2exception when unique_violation then\2  continue;\2end;\2placed := placed + 1;\3filled := filled + 1;$r$);
  execute def;
end $$;

create or replace function public.form_all_colleges()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare c record; made integer := 0; placed integer := 0; failed integer := 0; first_error text; r jsonb;
begin
  for c in
    select distinct s.college_id from public.seasons s
     where s.is_current and s.status = 'active' and s.college_id is not null
  loop
    begin
      r := public.form_squads(c.college_id);
      made   := made   + coalesce((r->>'squads_created')::int, 0);
      placed := placed + coalesce((r->>'students_placed')::int, 0);
    exception when others then
      -- One college's problem must not stop every other college's morning, but it must be seen (108).
      failed := failed + 1;
      first_error := coalesce(first_error, c.college_id || ': ' || left(sqlerrm, 200));
      raise notice 'squad formation failed for %: %', c.college_id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'squads_created', made, 'students_placed', placed,
                            'colleges_failed', failed, 'first_error', first_error,
                            'status', case when failed > 0 then 'partial_failure' else 'success' end,
                            'ran_at', now());
end $fn$;
revoke all on function public.form_all_colleges() from public, anon, authenticated;
grant execute on function public.form_all_colleges() to service_role;

do $$
declare
  f constant regprocedure := 'public.form_squads(uuid,uuid)'::regprocedure;
  def text := pg_get_functiondef(f); b record; a record;
begin
  select * into b from _108_before;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into a from pg_proc p where p.oid = f;
  if a.proowner <> b.proowner or a.prosecdef <> b.prosecdef or a.proconfig is distinct from b.proconfig or a.acl is distinct from b.acl then
    raise exception '108 self-check: form_squads changed more than its vacancy filling';
  end if;
  if position('pg_advisory_xact_lock(hashtext(''prooflab.squads''), hashtext(_college_id::text))' in def) = 0
     or position('and not s.is_locked -- 108' in def) = 0
     or position('< least(11, s.max_members)' in def) = 0
     or position('exception when unique_violation then' in def) = 0 then
    raise exception '108 self-check: form_squads is missing a 108 change';
  end if;
  if position('limit k * 11' in def) = 0 then
    raise exception '108 self-check: the drawing of new squads (elevens) is no longer there';
  end if;
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
     or not has_function_privilege('service_role', f, 'execute') then
    raise exception '108 self-check: form_squads privileges wrong';
  end if;
  if has_function_privilege('anon', 'public.form_all_colleges()', 'execute')
     or has_function_privilege('authenticated', 'public.form_all_colleges()', 'execute')
     or not has_function_privilege('service_role', 'public.form_all_colleges()', 'execute') then
    raise exception '108 self-check: form_all_colleges privileges wrong';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
