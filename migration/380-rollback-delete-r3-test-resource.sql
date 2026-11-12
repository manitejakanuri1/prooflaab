-- Rollback of 380: put the R3 test resource back from its backup, then drop the backup.
begin;
insert into public.learning_resources select * from public.backup_20261112_r3_resource
  on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from public.learning_resources where id = '3b2a4bfe-83f8-4a72-9da9-e166dd6a41cf') then
    raise exception '380 rollback: row not restored';
  end if;
end $$;
drop table public.backup_20261112_r3_resource;
commit;
