-- ROLLBACK for 151: anon and PUBLIC get "run" back on exactly the functions 151 saved, and the by-name grants
-- 151 added are taken away again. The self-check compares each function's permissions with the saved ones.
-- The backup table stays (it is the record of what 151 did).
begin;

do $$
declare
  b record;
  r text;
begin
  for b in select * from ops_backup.mf002_function_acl loop
    execute format('grant execute on routine %s to anon, public', b.fn);
    foreach r in array b.added_grants loop
      execute format('revoke execute on routine %s from %I', b.fn, r);
    end loop;
  end loop;
end $$;

do $$
declare
  bad text;
begin
  select string_agg(b.fn, ', ') into bad
  from ops_backup.mf002_function_acl b join pg_proc p on p.oid = b.fn::regprocedure
  where array(select distinct a.grantee::text || ':' || a.privilege_type
              from aclexplode(coalesce(b.acl, acldefault('f', p.proowner))) a order by 1)
     is distinct from
        array(select distinct a.grantee::text || ':' || a.privilege_type
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a order by 1);
  if bad is not null then
    raise exception '151 rollback self-check: permissions differ from the saved ones on %', bad;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
