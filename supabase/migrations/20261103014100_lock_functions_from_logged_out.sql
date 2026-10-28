-- 151 (MF-002): logged-out callers (anon) and "everyone" (PUBLIC) lose "run" on every public function,
-- except refuse_suspended: PostgREST runs it before every request, anonymous ones too (PGRST_DB_PRE_REQUEST).
-- It has a fixed search_path (public, pg_temp), returns void, and returns at once for anything that is not
-- an authenticated person, so a logged-out caller learns nothing from it.
-- The roles we use keep exactly what they could run: authenticated, service_role, and postgres (the role
-- PostgREST connects as before it switches to anon/authenticated/service_role). Anything they could run only
-- through PUBLIC is granted to them by name first. The self-check compares their EFFECTIVE permissions
-- (has_function_privilege) before and after on every public function; only anon may change.
-- Cloud SQL's own system roles (cloudsql*) lose the PUBLIC grant; they never call app functions.
-- Before-state: ops_backup.mf002_function_acl. Rollback: migration/151-rollback-lock-functions-from-logged-out.sql
begin;

create schema if not exists ops_backup;
revoke all on schema ops_backup from public;

create table ops_backup.mf002_function_acl (
  fn text primary key,                         -- regprocedure text, e.g. public.tpo_home()
  acl aclitem[],                               -- proacl before 151 (null = the built-in default)
  added_grants text[] not null default '{}'    -- roles 151 granted by name because they had it only via PUBLIC
);

insert into ops_backup.mf002_function_acl (fn, acl)
select p.oid::regprocedure::text, p.proacl
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.oid <> 'public.refuse_suspended()'::regprocedure
  and (has_function_privilege('anon', p.oid, 'execute')
       or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE'));

create temp table mf002_before on commit drop as
select r.rolname, p.oid as fn, has_function_privilege(r.rolname, p.oid, 'execute') as can
from pg_proc p cross join (values ('authenticated'), ('service_role'), ('postgres')) r(rolname)
where p.pronamespace = 'public'::regnamespace;

do $$
declare
  b record;
  r text;
  added text[];
begin
  for b in select fn from ops_backup.mf002_function_acl loop
    added := '{}';
    foreach r in array array['authenticated', 'service_role', 'postgres'] loop
      if has_function_privilege(r, b.fn::regprocedure, 'execute') and not exists (
           select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where p.oid = b.fn::regprocedure and a.grantee = r::regrole and a.privilege_type = 'EXECUTE') then
        execute format('grant execute on routine %s to %I', b.fn, r);
        added := added || r;
      end if;
    end loop;
    update ops_backup.mf002_function_acl set added_grants = added where fn = b.fn;
    execute format('revoke execute on routine %s from anon, public', b.fn);
  end loop;
end $$;

do $$
declare
  n int;
  open_fns text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into open_fns
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.oid <> 'public.refuse_suspended()'::regprocedure
    and has_function_privilege('anon', p.oid, 'execute');
  if open_fns is not null then
    raise exception '151 self-check: logged-out callers can still run %', open_fns;
  end if;
  if not has_function_privilege('anon', 'public.refuse_suspended()', 'execute') then
    raise exception '151 self-check: refuse_suspended must stay runnable for every request';
  end if;
  select count(*) into n from mf002_before b
  where b.can is distinct from has_function_privilege(b.rolname, b.fn, 'execute');
  if n > 0 then
    raise exception '151 self-check: % effective permissions changed for authenticated/service_role/postgres', n;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
