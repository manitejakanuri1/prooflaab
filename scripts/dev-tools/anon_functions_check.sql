-- MF-002 live check (TEST): lists every function a logged-out caller (anon) can run. Expected: only
-- public.refuse_suspended() and auth.* helpers. Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/anon_functions_check.sql
\pset format unaligned
\pset tuples_only on
select 'ANON_CAN_RUN=' || coalesce(string_agg(p.oid::regprocedure::text, ', ' order by 1), 'none')
from pg_proc p
where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  and has_function_privilege('anon', p.oid, 'execute');
do $$ begin
  if exists (select 1 from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.oid <> 'public.refuse_suspended()'::regprocedure
               and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'MF-002: a logged-out caller can run a public function (see ANON_CAN_RUN)';
  end if;
end $$;
select 'ANON_FUNCTIONS_CHECK=PASS';
