-- Read-only. Why did weekly scoring hit a row rule on daily_marks? Compares who owns the scoring functions and tables.
select 'RUNNER: ' || current_user;
select 'TABLE: ' || relname || ' | owner ' || pg_get_userbyid(relowner) || ' | rules ' || relrowsecurity || ' | forced ' || relforcerowsecurity
  from pg_class
 where oid in ('public.daily_marks'::regclass, 'public.student_weekly_scores'::regclass, 'public.squad_weekly_scores'::regclass,
               'public.squad_matches'::regclass, 'public.seasons'::regclass)
 order by relname;
select 'FUNCTION: ' || proname || ' | owner ' || pg_get_userbyid(proowner) || ' | definer ' || prosecdef
  from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('run_all_seasons', 'run_squad_week', 'advance_season', 'close_season')
 order by proname;
select 'POLICY: ' || policyname || ' | ' || cmd || ' | ' || array_to_string(roles, ',')
  from pg_policies where schemaname = 'public' and tablename = 'daily_marks';
-- Tables with row rules that the scoring function's owner does not own, so it is bound by those rules.
select 'NOT_OWNED_BY_SCORING: ' || relname
  from pg_class
 where relkind = 'r' and relnamespace = 'public'::regnamespace and relrowsecurity
   and not pg_has_role((select proowner from pg_proc where oid = 'public.run_squad_week(uuid,integer)'::regprocedure), relowner, 'USAGE')
 order by relname;
select 'SEASONS_ACTIVE: ' || count(*) from public.seasons where status = 'active';
