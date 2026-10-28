-- 152 (MF-002, tables): logged-out callers (anon) lose every permission on public tables and sequences.
-- Every one of these tables already had row protection (RLS) on and no rule that lets a logged-out caller see
-- a row, and nothing in the app reads tables without a login (the BFF refuses anonymous /api/db; the public
-- portfolio uses the BFF's own key). This removes the grants themselves, so a missing row rule can never open one.
-- The roles we use keep exactly what they had: authenticated, service_role, and postgres (the role PostgREST
-- connects as). The self-check compares their EFFECTIVE permissions (has_table_privilege /
-- has_sequence_privilege) before and after on every public table and sequence; only anon may change.
-- Before-state: ops_backup.mf002_table_acl (schema made by 151).
-- Rollback: migration/152-rollback-lock-tables-from-logged-out.sql
begin;

create table ops_backup.mf002_table_acl (
  rel text primary key,                  -- regclass text, e.g. public.tasks
  kind "char" not null,                  -- r table, p partitioned table, S sequence
  acl aclitem[]
);

insert into ops_backup.mf002_table_acl (rel, kind, acl)
select c.oid::regclass::text, c.relkind, c.relacl
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and exists (select 1 from aclexplode(c.relacl) a where a.grantee in (0, 'anon'::regrole));

create temp table mf002_before on commit drop as
select r.rolname, c.oid as rel, pv.p as priv,
       case when c.relkind = 'S' then has_sequence_privilege(r.rolname, c.oid, pv.p)
            else has_table_privilege(r.rolname, c.oid, pv.p) end as can
from pg_class c
cross join (values ('authenticated'), ('service_role'), ('postgres')) r(rolname)
cross join lateral unnest(case when c.relkind = 'S' then array['USAGE', 'SELECT', 'UPDATE']
                               else array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
                          end) pv(p)
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S');

do $$
declare
  b record;
begin
  for b in select rel, kind from ops_backup.mf002_table_acl loop
    execute format('revoke all on %s %s from anon, public',
                   case when b.kind = 'S' then 'sequence' else 'table' end, b.rel);
  end loop;
end $$;

do $$
declare
  n int;
  open_rels text;
begin
  select string_agg(c.oid::regclass::text, ', ') into open_rels
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and (exists (select 1 from aclexplode(c.relacl) a where a.grantee in (0, 'anon'::regrole))
         or exists (select 1 from pg_attribute t, aclexplode(t.attacl) a
                     where t.attrelid = c.oid and a.grantee in (0, 'anon'::regrole)));
  if open_rels is not null then
    raise exception '152 self-check: logged-out callers still hold permissions on %', open_rels;
  end if;
  select count(*) into n from mf002_before b
  where b.can is distinct from (case when (select relkind from pg_class where oid = b.rel) = 'S'
                                     then has_sequence_privilege(b.rolname, b.rel, b.priv)
                                     else has_table_privilege(b.rolname, b.rel, b.priv) end);
  if n > 0 then
    raise exception '152 self-check: % effective permissions changed for authenticated/service_role/postgres', n;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
