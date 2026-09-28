-- Step 6DD: READ-ONLY verification of migration 45. Changes nothing.
--
-- Run AFTER step6dd-migration-45-production-execution.sql has committed,
-- in Cloud SQL Studio on prooflab-db / database prooflab. The transaction
-- is READ ONLY, so Postgres itself refuses any write, and it ends in
-- ROLLBACK. Every row should show ok = true. (On staging, which ran the
-- original unfixed 45, rows 18 and 19 are expected to show false.)

begin transaction read only;

with fns as (
  select p.oid, p.proname, oidvectortypes(p.proargtypes) as args,
         pg_get_function_result(p.oid) as result, p.prosecdef, p.proowner, p.proconfig, p.proacl
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('claim_voice_scoring', 'complete_voice_scoring', 'fail_voice_scoring')
),
tbl as (
  select relowner, relrowsecurity from pg_class where oid = 'public.voice_explanations'::regclass
)
select check_name, detail, ok from (
  select 1 as n, 'scoring_lease_token column is uuid' as check_name,
         coalesce((select data_type from information_schema.columns
                    where table_schema = 'public' and table_name = 'voice_explanations'
                      and column_name = 'scoring_lease_token'), 'MISSING') as detail,
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'voice_explanations'
                    and column_name = 'scoring_lease_token' and data_type = 'uuid') as ok
  union all
  select 2, 'scoring_claimed_at column still present', '',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'voice_explanations'
                    and column_name = 'scoring_claimed_at')
  union all
  select 3, 'exactly 3 voice scoring functions', (select count(*)::text from fns),
         (select count(*) from fns) = 3
  union all
  select 4, 'claim_voice_scoring(uuid, integer) returns TABLE(claimed boolean, lease_token uuid)',
         coalesce((select result from fns where proname = 'claim_voice_scoring' and args = 'uuid, integer'), 'MISSING'),
         exists (select 1 from fns where proname = 'claim_voice_scoring' and args = 'uuid, integer'
                   and result = 'TABLE(claimed boolean, lease_token uuid)')
  union all
  select 5, 'complete_voice_scoring(uuid, uuid, integer, text) returns boolean',
         coalesce((select result from fns where proname = 'complete_voice_scoring' and args = 'uuid, uuid, integer, text'), 'MISSING'),
         exists (select 1 from fns where proname = 'complete_voice_scoring'
                   and args = 'uuid, uuid, integer, text' and result = 'boolean')
  union all
  select 6, 'fail_voice_scoring(uuid, uuid, text) returns boolean',
         coalesce((select result from fns where proname = 'fail_voice_scoring' and args = 'uuid, uuid, text'), 'MISSING'),
         exists (select 1 from fns where proname = 'fail_voice_scoring'
                   and args = 'uuid, uuid, text' and result = 'boolean')
  union all
  select 7, 'all 3 are SECURITY DEFINER', '',
         (select count(*) from fns where prosecdef) = 3
  union all
  select 8, 'all 3 pin search_path to public, pg_temp', '',
         (select count(*) from fns where 'search_path=public, pg_temp' = any (proconfig)) = 3
  union all
  select 9, 'all 3 owned by the table owner',
         (select string_agg(distinct proowner::regrole::text, ',') from fns),
         (select count(*) from fns, tbl where fns.proowner = tbl.relowner) = 3
  union all
  select 10, 'service_role can EXECUTE all 3', '',
         (select count(*) from fns where has_function_privilege('service_role', oid, 'EXECUTE')) = 3
  union all
  select 11, 'anon can EXECUTE none', '',
         (select count(*) from fns where has_function_privilege('anon', oid, 'EXECUTE')) = 0
  union all
  select 12, 'authenticated can EXECUTE none', '',
         (select count(*) from fns where has_function_privilege('authenticated', oid, 'EXECUTE')) = 0
  union all
  select 13, 'no PUBLIC EXECUTE grant on any of the 3', '',
         not exists (select 1 from fns,
                       aclexplode(coalesce(fns.proacl, acldefault('f', fns.proowner))) a
                      where a.grantee = 0)
  union all
  select 14, 'authenticated/anon still have no UPDATE on voice_explanations (47)', '',
         not has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE')
         and not has_table_privilege('anon', 'public.voice_explanations', 'UPDATE')
  union all
  select 15, 'service_role still has UPDATE on voice_explanations', '',
         has_table_privilege('service_role', 'public.voice_explanations', 'UPDATE')
  union all
  select 16, 'RLS still enabled on voice_explanations', '',
         (select relrowsecurity from tbl)
  union all
  select 17, 'guard_voice_explanations_insert() (43) still present', '',
         to_regprocedure('public.guard_voice_explanations_insert()') is not null
  union all
  select 18, 'fail_voice_scoring never overwrites a scored row (Step 6DD guard)', '',
         exists (select 1 from fns where proname = 'fail_voice_scoring'
                   and position('and status <> ''scored''' in (select prosrc from pg_proc where oid = fns.oid)) > 0)
  union all
  select 19, 'complete_voice_scoring never overwrites a scored row (Step 6DD guard)', '',
         exists (select 1 from fns where proname = 'complete_voice_scoring'
                   and position('and status <> ''scored''' in (select prosrc from pg_proc where oid = fns.oid)) > 0)
) c
order by n;

rollback;
