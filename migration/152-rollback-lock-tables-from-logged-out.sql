-- ROLLBACK for 152: anon (and PUBLIC, where it had any) get back exactly the table and sequence permissions
-- 152 saved. The self-check compares each one with the saved permissions. The backup table stays.
begin;

do $$
declare
  b record;
  g record;
begin
  for b in select * from ops_backup.mf002_table_acl loop
    for g in select a.grantee, string_agg(distinct a.privilege_type, ', ') as privs
             from aclexplode(b.acl) a where a.grantee in (0, 'anon'::regrole) group by a.grantee loop
      execute format('grant %s on %s %s to %s', g.privs,
                     case when b.kind = 'S' then 'sequence' else 'table' end, b.rel,
                     case when g.grantee = 0 then 'public' else 'anon' end);
    end loop;
  end loop;
end $$;

do $$
declare
  bad text;
begin
  select string_agg(b.rel, ', ') into bad
  from ops_backup.mf002_table_acl b join pg_class c on c.oid = b.rel::regclass
  where array(select distinct a.grantee::text || ':' || a.privilege_type from aclexplode(b.acl) a order by 1)
     is distinct from
        array(select distinct a.grantee::text || ':' || a.privilege_type from aclexplode(c.relacl) a order by 1);
  if bad is not null then
    raise exception '152 rollback self-check: permissions differ from the saved ones on %', bad;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
