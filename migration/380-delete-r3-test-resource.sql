-- 380 (owner approved 12 Nov 2026, TEST only): delete the old link-only resource "R3 test resource"
--   (learning_resources, url only, no body - never shown to students since 335). Copied first into
--   backup_20261112_r3_resource. Nothing references learning_resources (no foreign keys).
--   The 17 hidden badge rows (351) were NOT deleted: TEST has 13 such rows, not 17 - owner to re-confirm.
-- Rollback: migration/380-rollback-delete-r3-test-resource.sql
begin;
create table public.backup_20261112_r3_resource as
  select * from public.learning_resources
   where id = '3b2a4bfe-83f8-4a72-9da9-e166dd6a41cf' and title = 'R3 test resource'
     and btrim(coalesce(body, '')) = '';
alter table public.backup_20261112_r3_resource enable row level security;  -- no policy: admins/service only
revoke all on public.backup_20261112_r3_resource from public, anon, authenticated;

delete from public.learning_resources r
 using public.backup_20261112_r3_resource b where r.id = b.id;

do $$ begin
  if (select count(*) from public.backup_20261112_r3_resource) <> 1 then
    raise exception '380: expected exactly 1 backed-up row';
  end if;
  if exists (select 1 from public.learning_resources where id = '3b2a4bfe-83f8-4a72-9da9-e166dd6a41cf') then
    raise exception '380: row still there';
  end if;
  raise notice '380 self-check: true';
end $$;
commit;
