-- 216: weekly scoring and the season champion could not save on the REAL database.
--   run_squad_week and close_season are SECURITY DEFINER, so they run as their owner. On REAL that owner is
--   prooflab_app, but daily_marks (165) and season_champions (117) are owned by postgres, and both have row rules
--   with no write rule. The owner mismatch means the rules apply: "new row violates row-level security policy".
--   This hands those two tables to prooflab_app, the owner of the functions and of the other season tables.
--   Row rules and grants for students, colleges and logged-out visitors do not change.
-- TEST has no prooflab_app role and one owner for everything, so this file changes nothing there.
-- Apply on REAL as postgres (gcloud sql import). The SQL runner job logs in as prooflab_app and cannot run it.
-- Rollback: migration/216-rollback-season-scoring-table-owner.sql
begin;

do $m$
declare
  t regclass;
  grants_before text; grants_after text;
  grants_sql constant text := $q$
    select coalesce(string_agg(pg_get_userbyid(a.grantee) || ':' || c.relname || ':' || a.privilege_type, ',' order by 1), '')
      from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid in ('public.daily_marks'::regclass, 'public.season_champions'::regclass)
       and a.grantee <> 0 and pg_get_userbyid(a.grantee) not in ('postgres', 'prooflab_app')$q$;
  policies_before integer; policies_after integer;
begin
  if not exists (select 1 from pg_roles where rolname = 'prooflab_app') then
    raise notice '216: no prooflab_app role on this database. Nothing to do.';
    return;
  end if;
  if not pg_has_role(current_user, 'prooflab_app', 'USAGE') or not has_schema_privilege('prooflab_app', 'public', 'CREATE') then
    raise exception '216: must run as postgres, and prooflab_app must be able to own tables in public. Nothing changed.';
  end if;

  execute grants_sql into grants_before;
  select count(*) into policies_before from pg_policies
   where schemaname = 'public' and tablename in ('daily_marks', 'season_champions');

  alter table public.daily_marks owner to prooflab_app;
  alter table public.season_champions owner to prooflab_app;

  -- Self-check: the new owner, the rules still on, and nobody else's access changed.
  execute grants_sql into grants_after;
  select count(*) into policies_after from pg_policies
   where schemaname = 'public' and tablename in ('daily_marks', 'season_champions');
  if grants_after is distinct from grants_before then
    raise exception '216: grants changed. Before: % After: %', grants_before, grants_after;
  end if;
  if policies_after <> policies_before then
    raise exception '216: row rules changed: % became %', policies_before, policies_after;
  end if;
  foreach t in array array['public.daily_marks'::regclass, 'public.season_champions'::regclass] loop
    if not exists (select 1 from pg_class where oid = t and relowner = 'prooflab_app'::regrole and relrowsecurity and not relforcerowsecurity) then
      raise exception '216: % does not have the expected owner and row rules', t;
    end if;
  end loop;

  -- Self-check: the scoring functions' owner is now free of these two rules. The role switch ends before commit.
  set local role prooflab_app;
  if row_security_active('public.daily_marks') or row_security_active('public.season_champions') then
    raise exception '216: prooflab_app is still bound by the row rules';
  end if;
  reset role;
end $m$;

commit;
