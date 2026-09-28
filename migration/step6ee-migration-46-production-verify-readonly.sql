-- Step 6EE: READ-ONLY verification of migration 46. Changes nothing.
--
-- Run AFTER step6ee-migration-46-production-execution.sql has committed,
-- in Cloud SQL Studio on prooflab-db / database prooflab. READ ONLY
-- transaction, ends in ROLLBACK. Every row must show ok = true.

begin transaction read only;

with f as (
  select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig, p.proowner, p.proacl,
         md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) as norm_md5
    from pg_proc p
   where p.oid in (to_regprocedure('public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)'),
                   to_regprocedure('public.recruiter_proof_profile(uuid)'))
)
select n, check_name, detail, ok from (
  select 1 as n, 'recruiter_talent body is the Step 6EE version' as check_name,
         (select norm_md5 from f where proname = 'recruiter_talent') as detail,
         (select norm_md5 from f where proname = 'recruiter_talent') = 'd3ec3dda80922a036fc3d39460ced541' as ok
  union all
  select 2, 'recruiter_proof_profile body is the Step 6EE version',
         (select norm_md5 from f where proname = 'recruiter_proof_profile'),
         (select norm_md5 from f where proname = 'recruiter_proof_profile') = '2d048797e2d64852834c65ef4d24170a'
  union all
  select 3, 'recruiter_talent still counts passed task_submissions (stage69 kept)', '',
         (select position('task_submissions' in prosrc) > 0 from f where proname = 'recruiter_talent')
  union all
  select 4, 'server-only filter: 1 in talent, 2 in profile', '',
         (select (length(prosrc) - length(replace(prosrc, 'transcript_source = ''server''', '')))
                 / length('transcript_source = ''server''') from f where proname = 'recruiter_talent') = 1
         and (select (length(prosrc) - length(replace(prosrc, 'transcript_source = ''server''', '')))
                 / length('transcript_source = ''server''') from f where proname = 'recruiter_proof_profile') = 2
  union all
  select 5, 'both SECURITY DEFINER', '', (select count(*) from f where prosecdef) = 2
  union all
  select 6, 'both pin search_path to public, pg_temp', '',
         (select count(*) from f where 'search_path=public, pg_temp' = any (proconfig)) = 2
  union all
  select 7, 'authenticated can EXECUTE both', '',
         (select count(*) from f where has_function_privilege('authenticated', oid, 'EXECUTE')) = 2
  union all
  select 8, 'anon can EXECUTE neither', '',
         (select count(*) from f where has_function_privilege('anon', oid, 'EXECUTE')) = 0
  union all
  select 9, 'no PUBLIC EXECUTE on either', '',
         not exists (select 1 from f, aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where a.grantee = 0)
  union all
  select 10, 'return types unchanged', '',
         (select pg_get_function_result(oid) from f where proname = 'recruiter_proof_profile') = 'jsonb'
         and (select pg_get_function_result(oid) from f where proname = 'recruiter_talent') like 'TABLE(student_id uuid,%total_matches bigint)'
  union all
  select 11, 'owner (info)', (select string_agg(distinct proowner::regrole::text, ',') from f), true
) c order by n;

rollback;
