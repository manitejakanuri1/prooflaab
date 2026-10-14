-- READ-ONLY preflight for migrations 100 (managed-accounts-only policies) and 101 (sessions end when
-- access ends). NOT RUN by Claude. Every statement is a SELECT inside a read-only transaction;
-- nothing is created, changed or deleted. Run on STAGING first, keep the output with the review.
--
-- Known for staging on 8 Oct 2026 (TEJA): user_roles_self_claim, colleges_own_insert and
-- startups_self_signup are active; row-level security is on for all three tables; the ledger records
-- 95, 96, 97 and 98; 99 is not recorded. This file re-reads those facts and the few that are still
-- unknown, in the exact form the two migrations' own self-checks will test them.
begin transaction read only;

-- 1. Ledger: 95-98 must be present; 99, 100, 101 must be absent.
select version, applied_at
  from public.schema_migrations
 where version ~ '^(9[4-9]|1[0-9][0-9])[a-z]?-'
 order by version;

-- 2. Every INSERT-capable policy on the three tables, and what migration 100 will do with it.
--    'blocks 100' means 100's self-check would refuse and roll itself back: resolve that row first.
select tablename, policyname, cmd, roles,
       coalesce(with_check, qual) as rule,
       case
         when policyname in ('user_roles_self_claim', 'startups_self_signup', 'colleges_own_insert') then 'dropped by 100'
         when coalesce(with_check, qual, '') !~ 'is_admin\s*\(' then 'BLOCKS 100: lets a non-administrator insert'
         when coalesce(with_check, qual, '') ~ 'auth\.uid\s*\(' then 'BLOCKS 100: lets a login insert its own row'
         else 'kept'
       end as migration_100
  from pg_policies
 where schemaname = 'public'
   and tablename in ('user_roles', 'colleges', 'startups')
   and cmd in ('INSERT', 'ALL')
 order by tablename, policyname;

-- 3. Row-level security really on (and whether the table owner is exempt).
select relname, relrowsecurity as rls_on, relforcerowsecurity as forced
  from pg_class
 where oid in ('public.user_roles'::regclass, 'public.colleges'::regclass, 'public.startups'::regclass,
               'public.student_profiles'::regclass, 'public.web_sessions'::regclass);

-- 4. Provisioning keeps working after 100 only if the server role bypasses row-level security
--    and the three provisioning functions run as their owner. All must be true.
select (select rolbypassrls from pg_roles where rolname = 'service_role') as service_role_bypasses_rls,
       (select bool_and(prosecdef) from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('provision_college_account', 'provision_company_account', 'provision_admin_account')) as provisioning_is_definer,
       (select array_agg(proname order by proname) from pg_proc
         where pronamespace = 'public'::regnamespace and proname like 'provision\_%\_account') as provisioning_functions;

-- 5. What 101 needs: the columns its triggers name, the rule it asks, and no trigger of the same name yet.
select table_name, array_agg(column_name::text order by column_name) as columns_present
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name in ('colleges', 'startups') and column_name in ('user_id', 'name', 'status', 'verification_status'))
     or (table_name = 'student_profiles' and column_name in ('user_id', 'full_name', 'college_id', 'status', 'onboarding_status'))
     or (table_name = 'user_roles' and column_name in ('user_id', 'role'))
     or (table_name = 'web_sessions' and column_name in ('user_id', 'revoked_at', 'last_seen_at')))
 group by table_name order by table_name;   -- expect 4, 4, 5, 2, 3 columns

select to_regprocedure('public.web_login_identity(uuid)') is not null as has_login_rule,
       has_function_privilege('authenticated', 'public.web_login_identity(uuid)', 'execute') as browser_can_call_it;   -- t, f

select tgrelid::regclass as on_table, tgname, pg_get_triggerdef(oid) as definition
  from pg_trigger
 where not tgisinternal
   and tgrelid in ('public.colleges'::regclass, 'public.startups'::regclass,
                   'public.student_profiles'::regclass, 'public.user_roles'::regclass)
 order by 1, 2;

-- 6. Who is affected the moment 101 is applied: nobody. It revokes only when a row changes
--    afterwards. For information: open sessions whose account is ALREADY not allowed today
--    (these would be ended by the web BFF's own re-check within 30 seconds of its deployment).
select coalesce(public.web_login_identity(ws.user_id) ->> 'reason', 'allowed') as account_state,
       count(*) as open_sessions
  from public.web_sessions ws
 where ws.revoked_at is null and ws.expires_at > now()
 group by 1 order by 1;

-- 7. Accounts that used the self-service rules (for the record; 100 changes none of them).
select 'role rows with no creator recorded' as what, count(*) from public.user_roles where created_by is null
union all
select 'companies still pending', count(*) from public.startups where verification_status = 'pending'
union all
select 'colleges not approved', count(*) from public.colleges where verification_status is distinct from 'approved';

rollback;
